-- Order lifecycle: the Shopify customer behind each order, for the reorder check, and one row per
-- cancelled order. Run as the superuser; the new table goes to the app owner like orders.
\getenv runtime_role APP_RUNTIME_DB_USER
\getenv owner_role APP_DB_USER

ALTER TABLE orders ADD COLUMN IF NOT EXISTS customer_id text;
CREATE INDEX IF NOT EXISTS orders_customer_id_received_at_idx ON orders (customer_id, received_at) WHERE customer_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS order_cancellations (
  order_id     text PRIMARY KEY REFERENCES orders (order_id) ON DELETE CASCADE,
  cancelled_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE order_cancellations OWNER TO :"owner_role";
GRANT SELECT, INSERT ON order_cancellations TO :"runtime_role";
