.PHONY: up down reset wait-db migrate seed smoke

up:
	docker compose up --build -d

down:
	docker compose down

reset:
	docker compose down -v

wait-db:
	docker compose exec -T api python scripts/wait_for_db.py

migrate: wait-db
	docker compose exec -T api alembic upgrade head

seed:
	docker compose exec -T api python scripts/seed_data.py

smoke:
	./scripts/smoke_test.sh
