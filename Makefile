# =============================================================================
# Spotify Poller — Makefile
# Controls the Docker Compose stacks (local dev + Home Lab).
# Same conventions as the Spotify Calendar Makefile.
# =============================================================================

DC        := docker compose
DEV_FILE  := docker-compose.yml
PROD_FILE := docker-compose.prod.yml
DC_PROD   := $(DC) -f $(PROD_FILE)
TSX       := node_modules/.bin/tsx

.DEFAULT_GOAL := help

# ---- Meta -------------------------------------------------------------------
.PHONY: help
help: ## Show this help
	@echo "Spotify Poller — available commands:"
	@echo ""
	@grep -E '^[a-zA-Z0-9_-]+:.*?## .*$$' $(MAKEFILE_LIST) \
	  | awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-16s\033[0m %s\n", $$1, $$2}'
	@echo ""

.PHONY: init
init: ## Create .env from template (if missing) and build the dev image
	@if [ ! -f .env ]; then \
	  cp .env.example .env; \
	  echo "Created .env from .env.example — edit it with your Spotify credentials."; \
	else \
	  echo ".env already exists — leaving it untouched."; \
	fi
	$(MAKE) build

# ---- Local development ------------------------------------------------------
.PHONY: build
build: ## Build the local dev image
	$(DC) build

.PHONY: up
up: ## Start the dev stack in the background
	$(DC) up -d

.PHONY: start
start: ## Start the dev stack in the foreground (Ctrl-C to stop)
	$(DC) up

.PHONY: stop
stop: ## Pause the dev stack (containers kept, `make start`/`up` resumes fast)
	$(DC) stop

.PHONY: down
down: ## Stop and remove the dev stack
	$(DC) down

.PHONY: restart
restart: ## Restart the dev stack
	$(DC) restart

.PHONY: reset
reset: ## Full clean rebuild: tear down (+volumes), rebuild image no-cache, start
	$(DC) down -v --remove-orphans
	$(DC) build --no-cache
	$(DC) up -d
	@echo "Reset complete — poller running on http://127.0.0.1:$${APP_PORT:-3000}"

.PHONY: logs
logs: ## Follow dev logs
	$(DC) logs -f

.PHONY: shell
shell: ## Open a shell inside the dev container
	$(DC) exec poller sh

# ---- Poller operations (dev stack) ------------------------------------------
.PHONY: migrate
migrate: ## Apply pending SQL migrations inside the dev container
	$(DC) exec poller $(TSX) scripts/migrate.ts

.PHONY: run-played
run-played: ## Run the 'played' collector (recently played) once in the dev container
	$(DC) exec poller $(TSX) scripts/run-once.ts played

.PHONY: run-liked
run-liked: ## Run the 'liked' collector (liked tracks) once in the dev container
	$(DC) exec poller $(TSX) scripts/run-once.ts liked

.PHONY: run-artists
run-artists: ## Fetch artist genres for the collected history once (dev container)
	$(DC) exec poller $(TSX) scripts/run-once.ts artists

.PHONY: backup
backup: ## Write a full .db snapshot into BACKUP_DIR (dev container)
	$(DC) exec poller $(TSX) scripts/backup.ts

.PHONY: export
export: ## Dump the active account's events as NDJSON to stdout (no secret inside)
	@$(DC) exec -T poller $(TSX) scripts/export.ts

.PHONY: import
import: ## Restore events from an NDJSON file: make import FILE=events.ndjson
	@test -n "$(FILE)" || { echo "usage: make import FILE=events.ndjson"; exit 2; }
	$(DC) exec -T poller $(TSX) scripts/import.ts < "$(FILE)"

# ---- Home Lab / production --------------------------------------------------
# The image is built & published to GHCR by .github/workflows/docker-build.yml
# on every push to main — the Home Lab stack pulls it rather than building
# locally (see docker-compose.prod.yml).
.PHONY: prod-pull
prod-pull: ## Pull the latest published image from GHCR
	$(DC_PROD) pull

.PHONY: prod-up
prod-up: ## Start the Home Lab stack in the background
	$(DC_PROD) up -d

.PHONY: prod-start
prod-start: ## Start the Home Lab stack in the foreground
	$(DC_PROD) up

.PHONY: prod-stop
prod-stop: ## Pause the Home Lab stack (container kept, `prod-up` resumes fast)
	$(DC_PROD) stop

.PHONY: prod-down
prod-down: ## Stop and remove the Home Lab stack
	$(DC_PROD) down

.PHONY: prod-logs
prod-logs: ## Follow Home Lab logs
	$(DC_PROD) logs -f

.PHONY: prod-deploy
prod-deploy: ## Pull the latest image and (re)start the Home Lab stack
	$(DC_PROD) pull
	$(DC_PROD) up -d

.PHONY: prod-shell
prod-shell: ## Open a shell inside the Home Lab container
	$(DC_PROD) exec spotify-poller sh

.PHONY: prod-migrate
prod-migrate: ## Apply pending SQL migrations inside the Home Lab container
	$(DC_PROD) exec spotify-poller $(TSX) scripts/migrate.ts

.PHONY: prod-run-played
prod-run-played: ## Run the 'played' collector once inside the Home Lab container
	$(DC_PROD) exec spotify-poller $(TSX) scripts/run-once.ts played

.PHONY: prod-run-liked
prod-run-liked: ## Run the 'liked' collector once inside the Home Lab container
	$(DC_PROD) exec spotify-poller $(TSX) scripts/run-once.ts liked

.PHONY: prod-run-artists
prod-run-artists: ## Fetch artist genres for the collected history (Home Lab container)
	$(DC_PROD) exec spotify-poller $(TSX) scripts/run-once.ts artists

# The snapshot lands on ./backups, bind-mounted from the host — deliberately
# OUTSIDE the spotify-poller-data volume. A backup stored next to the database
# it protects does not survive losing that volume.
.PHONY: backups-dir
backups-dir: ## Create ./backups owned by the container user (uid 1001) — run once
	mkdir -p backups
	sudo chown 1001:1001 backups
	chmod 700 backups
	@echo "./backups ready (mode 700 — snapshots contain the Spotify refresh token)"

.PHONY: prod-backup
prod-backup: ## Write a full .db snapshot into ./backups on the host
	$(DC_PROD) exec spotify-poller $(TSX) scripts/backup.ts

.PHONY: prod-export
prod-export: ## Dump the active account's events as NDJSON: make prod-export > events.ndjson
	@$(DC_PROD) exec -T spotify-poller $(TSX) scripts/export.ts

.PHONY: prod-import
prod-import: ## Restore events from NDJSON: make prod-import FILE=events.ndjson
	@test -n "$(FILE)" || { echo "usage: make prod-import FILE=events.ndjson"; exit 2; }
	$(DC_PROD) exec -T spotify-poller $(TSX) scripts/import.ts < "$(FILE)"

# ---- Housekeeping -----------------------------------------------------------
.PHONY: ps
ps: ## Show running containers
	$(DC) ps

.PHONY: clean
clean: ## Stop everything and remove built image (keeps the PROD data volume!)
	-$(DC) down -v
	-$(DC_PROD) down
	-docker image rm ghcr.io/costardrouge/spotify-poller:latest 2>/dev/null || true
	@echo "NOTE: the prod data volume (spotify-poller-data) is intentionally kept —"
	@echo "      the collected history is irreplaceable. Remove it manually if you"
	@echo "      really mean it: docker volume rm spotify-poller_spotify-poller-data"
