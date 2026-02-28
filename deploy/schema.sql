-- Performance indexes for detection_events and event_images
-- Run these on the production database (idempotent).
-- IMPORTANT: CREATE INDEX CONCURRENTLY must run outside explicit transactions.

-- Trigram index for ILIKE searches (requires pg_trgm extension)
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_events_plate_text ON detection_events(camera_plate_text);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_events_created_at ON detection_events(created_at DESC);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_images_created_at ON event_images(created_at DESC);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_events_plate_trgm ON detection_events USING GIN (camera_plate_text gin_trgm_ops);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_event_images_event_type_id ON event_images(event_id, image_type, id);
