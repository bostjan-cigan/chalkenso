-- What an organisation agreed to pay per billing period at its last checkout, in whole US dollars (null
-- before any checkout). It stays as it was when the plans' prices change: the price a founding customer
-- keeps (the terms promise it while they stay on the plan).
ALTER TABLE "public"."organizations" ADD COLUMN "period_price_usd" INTEGER;
