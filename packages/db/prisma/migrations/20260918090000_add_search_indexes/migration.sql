-- Global search (SOW §16, P1A-09).
--
-- Trigram indexes rather than plain ILIKE scans. Two reasons, in order of importance:
--
-- 1. Staff misspell names constantly, and an Arabic name transliterated into Latin has
--    no single correct spelling — Mansoori, Mansouri and Mansuri are the same family.
--    A search that only does substring matching finds none of them from the others.
-- 2. `col ILIKE '%x%'` cannot use a btree index at all, so every search is a sequential
--    scan of every table. That is survivable at a hundred customers and not at ten
--    thousand, and it is far cheaper to add the index now than to diagnose it later.
--
-- gin_trgm_ops serves both the similarity operator (%) and ILIKE '%…%'.

CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS customers_full_name_trgm ON customers USING gin (full_name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS customers_mobile_trgm ON customers USING gin (mobile gin_trgm_ops);
CREATE INDEX IF NOT EXISTS customers_code_trgm ON customers USING gin (code gin_trgm_ops);
CREATE INDEX IF NOT EXISTS customers_email_trgm ON customers USING gin (email gin_trgm_ops);

CREATE INDEX IF NOT EXISTS suppliers_company_name_trgm ON suppliers USING gin (company_name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS suppliers_code_trgm ON suppliers USING gin (code gin_trgm_ops);
CREATE INDEX IF NOT EXISTS suppliers_contact_person_trgm ON suppliers USING gin (contact_person gin_trgm_ops);
CREATE INDEX IF NOT EXISTS suppliers_trn_trgm ON suppliers USING gin (trn gin_trgm_ops);

-- Emirates ID, driving licence, passport and trade licence numbers all live here: the
-- number is a property of the document, not of the person.
CREATE INDEX IF NOT EXISTS documents_document_number_trgm ON documents USING gin (document_number gin_trgm_ops);
