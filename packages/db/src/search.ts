/**
 * Global search (SOW §16, P1A-09).
 *
 * One box that finds a person by name, by the number they read out over the phone, or by
 * the number printed on their Emirates ID. Staff do not know which table their answer is
 * in, and should not have to.
 *
 * Raw SQL rather than Prisma's query builder: ranking across three tables by trigram
 * similarity is not something the builder expresses, and the ranking is the feature. A
 * list of everything containing "Ahmed" in no particular order is not search.
 */

import { formatPartyCode, normaliseUaeMobile, parsePartyCode } from "@drivenx/core";

import { Prisma } from "../generated/client";
import { prisma } from "./index";

export type SearchKind = "customer" | "supplier" | "document";

export interface SearchHit {
  kind: SearchKind;
  id: string;
  label: string;
  sublabel: string | null;
  /** For a document, the record it is attached to — that is where the reader wants to go. */
  ownerType: string | null;
  ownerId: string | null;
  score: number;
}

export interface SearchOptions {
  customers?: boolean;
  suppliers?: boolean;
  documents?: boolean;
  limit?: number;
}

/**
 * Below this, results are noise. Trigram similarity on short strings is generous, and a
 * search that returns everything is the same as one that returns nothing.
 */
const MINIMUM_SCORE = 0.22;

/** An exact-ish substring hit outranks a fuzzy one; both outrank a distant match. */
const SUBSTRING_SCORE = 0.55;

export async function globalSearch(
  rawQuery: string,
  options: SearchOptions = {},
): Promise<SearchHit[]> {
  const query = rawQuery.trim();
  if (query.length < 2) return [];

  const { customers = true, suppliers = true, documents = true, limit = 20 } = options;

  const like = `%${query}%`;
  // "050 123 4567" and "+971501234567" are the same number; the stored form is the
  // normalised one, so the typed form has to be translated before it will match.
  const mobileLike = `%${normaliseUaeMobile(query) ?? query}%`;
  // "cus 42" should find CUS-00042 rather than fuzzily matching every code.
  const code = parsePartyCode(query);
  // Formatted by the same function that minted it. Building the string by hand here once
  // mapped every non-customer kind to SUP, which a vehicle code would have hit silently.
  const codeExact = code ? formatPartyCode(code.kind, code.sequence) : null;

  const branches: Prisma.Sql[] = [];

  if (customers) {
    branches.push(Prisma.sql`
      SELECT 'customer' AS kind, c.id, c.full_name AS label, c.mobile AS sublabel,
             NULL::text AS owner_type, NULL::text AS owner_id,
             GREATEST(
               similarity(c.full_name, ${query}),
               similarity(c.code, ${query}),
               CASE WHEN c.code = ${codeExact} THEN 1.0 ELSE 0 END,
               CASE WHEN c.full_name ILIKE ${like}
                      OR c.code ILIKE ${like}
                      OR c.mobile ILIKE ${mobileLike}
                      OR COALESCE(c.email, '') ILIKE ${like}
                    THEN ${SUBSTRING_SCORE} ELSE 0 END
             ) AS score
      FROM customers c
      WHERE c.deleted_at IS NULL
        AND (c.full_name ILIKE ${like}
             OR c.code ILIKE ${like}
             OR c.code = ${codeExact}
             OR c.mobile ILIKE ${mobileLike}
             OR COALESCE(c.email, '') ILIKE ${like}
             OR c.full_name % ${query})
    `);
  }

  if (suppliers) {
    branches.push(Prisma.sql`
      SELECT 'supplier' AS kind, s.id, s.company_name AS label, s.contact_person AS sublabel,
             NULL::text AS owner_type, NULL::text AS owner_id,
             GREATEST(
               similarity(s.company_name, ${query}),
               similarity(s.code, ${query}),
               CASE WHEN s.code = ${codeExact} THEN 1.0 ELSE 0 END,
               CASE WHEN s.company_name ILIKE ${like}
                      OR s.code ILIKE ${like}
                      OR COALESCE(s.contact_person, '') ILIKE ${like}
                      OR COALESCE(s.trn, '') ILIKE ${like}
                    THEN ${SUBSTRING_SCORE} ELSE 0 END
             ) AS score
      FROM suppliers s
      WHERE s.deleted_at IS NULL
        AND (s.company_name ILIKE ${like}
             OR s.code ILIKE ${like}
             OR s.code = ${codeExact}
             OR COALESCE(s.contact_person, '') ILIKE ${like}
             OR COALESCE(s.trn, '') ILIKE ${like}
             OR s.company_name % ${query})
    `);
  }

  if (documents) {
    branches.push(Prisma.sql`
      SELECT 'document' AS kind, d.id, COALESCE(d.document_number, d.file_name) AS label,
             cat.label AS sublabel,
             d.owner_type::text AS owner_type, d.owner_id AS owner_id,
             GREATEST(
               similarity(COALESCE(d.document_number, ''), ${query}),
               CASE WHEN COALESCE(d.document_number, '') ILIKE ${like}
                    THEN ${SUBSTRING_SCORE} ELSE 0 END
             ) AS score
      FROM documents d
      JOIN document_categories cat ON cat.id = d.category_id
      WHERE d.deleted_at IS NULL
        AND d.document_number IS NOT NULL
        AND (d.document_number ILIKE ${like} OR d.document_number % ${query})
    `);
  }

  if (branches.length === 0) return [];

  const rows = await prisma.$queryRaw<
    Array<{
      kind: SearchKind;
      id: string;
      label: string;
      sublabel: string | null;
      owner_type: string | null;
      owner_id: string | null;
      score: number;
    }>
  >(Prisma.sql`
    SELECT * FROM (${Prisma.join(branches, " UNION ALL ")}) hits
    WHERE score >= ${MINIMUM_SCORE}
    ORDER BY score DESC, label ASC
    LIMIT ${limit}
  `);

  return rows.map((row) => ({
    kind: row.kind,
    id: row.id,
    label: row.label,
    sublabel: row.sublabel,
    ownerType: row.owner_type,
    ownerId: row.owner_id,
    score: Number(row.score),
  }));
}
