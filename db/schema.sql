CREATE TABLE orders (
  order_id     text PRIMARY KEY,
  order_number text NOT NULL,
  received_at  timestamptz NOT NULL DEFAULT now()
);
