-- Integration and reconciliation tests run against a real Postgres (IMPLEMENTATION_PLAN.md §2.2),
-- isolated from the development database so a test reset never touches dev data.
CREATE DATABASE drivenx_test OWNER drivenx;
