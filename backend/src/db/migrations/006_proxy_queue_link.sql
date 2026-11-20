-- Environment-configured NPM may not have a provider registry record.
ALTER TABLE proxy_hosts ALTER COLUMN edge_provider_id DROP NOT NULL;
ALTER TABLE proxy_mutation_queue ADD COLUMN proxy_host_id UUID;
