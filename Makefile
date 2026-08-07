# =============================================================================
# Spotify Poller — Makefile
# Controls the Docker Compose stacks (local dev + Home Lab).
# Same conventions as the Spotify Calendar Makefile.
# =============================================================================

DC        := docker compose
DEV_FILE  := docker-compose.yml
PROD_FILE := docker-compose.prod.yml
DC_PROD   := $(DC) -f $(PROD_FILE)

.DEFAULT_GOAL := help

# ---- Meta -------------------------------------------------------------------
.PHONY: help
help: ## Show this help
	@echo "Spotify Poller — available commands:"
	@echo ""
	@grep -E '^[a-zA-Z0-9_-]+:.*?## .*$$' $(MAKEFILE_LIST) \
	  | awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-14s\033[0m %s\n", $$1, $$2}'
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
	@echo "Reset complete — poller running on http://127.0.0.1:$${APP_PORT:-8787}"

.PHONY: logs
logs: ## Follow dev logs
	$(DC) logs -f

.PHONY: shell
shell: ## Open a shell inside the dev container
	$(DC) exec poller sh

# ---- Poller operations (dev stack) ------------------------------------------
.PHONY: migrate
migrate: ## Apply pending SQL migrations inside the dev container
	$(DC) exec poller node dist/migrate.js

.PHONY: run-played
run-played: ## Run the 'played' collector (recently played) once in the dev container
	$(DC) exec poller node dist/run-once.js played

.PHONY: run-liked
run-liked: ## Run the 'liked' collector (liked tracks) once in the dev container
	$(DC) exec poller node dist/run-once.js liked

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
	$(DC_PROD) exec spotify-poller node dist/migrate.js

.PHONY: prod-run-played
prod-run-played: ## Run the 'played' collector once inside the Home Lab container
	$(DC_PROD) exec spotify-poller node dist/run-once.js played

.PHONY: prod-run-liked
prod-run-liked: ## Run the 'liked' collector once inside the Home Lab container
	$(DC_PROD) exec spotify-poller node dist/run-once.js liked

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
