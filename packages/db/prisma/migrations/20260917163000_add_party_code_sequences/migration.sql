-- Human-facing party codes: CUS-00001, SUP-00001.
--
-- A sequence rather than MAX(code) + 1. Two staff creating a customer in the same moment
-- both read the same maximum, and the loser hits the unique constraint on customers.code
-- — an error the person who did nothing wrong has to resolve. nextval is atomic and never
-- hands out the same number twice.
--
-- The trade-off is gaps: a sequence does not roll back with its transaction, so an
-- abandoned create burns a number. A gap in customer numbering is harmless. A collision
-- at the counter is not.

CREATE SEQUENCE IF NOT EXISTS customer_code_seq AS BIGINT START WITH 1 INCREMENT BY 1;
CREATE SEQUENCE IF NOT EXISTS supplier_code_seq AS BIGINT START WITH 1 INCREMENT BY 1;
