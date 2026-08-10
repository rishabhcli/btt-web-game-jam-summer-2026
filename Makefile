.PHONY: bootstrap build check clean dev-down dev-health dev-preflight dev-up format lint release-check run-local test test-e2e test-e2e-preview test-e2e-static test-integration typecheck verify-all

bootstrap:
	npm run bootstrap

build:
	npm run build

check:
	npm run check

clean:
	npm run clean

dev-preflight:
	npm run dev:preflight

dev-up:
	npm run dev:up

dev-health:
	npm run dev:health

dev-down:
	npm run dev:down

format:
	npm run format

lint:
	npm run lint

test:
	npm run test

test-integration:
	npm run test:integration

test-e2e:
	npm run test:e2e

test-e2e-preview:
	npm run test:e2e:preview

test-e2e-static:
	npm run test:e2e:static

typecheck:
	npm run typecheck

run-local:
	npm run run-local

release-check:
	npm run release-check

verify-all:
	npm run verify-all
