BIN := runway
INSTALL_DIR ?= $(HOME)/.local/bin

.PHONY: build install uninstall clean test tidy

build:
	bun run build

install: build
	@mkdir -p "$(INSTALL_DIR)"
	@install -m 755 "$(BIN)" "$(INSTALL_DIR)/$(BIN)"
	@echo "✓ Instalado en $(INSTALL_DIR)/$(BIN)"
	@echo "  Asegúrate de que $(INSTALL_DIR) está en tu PATH."

uninstall:
	@rm -f "$(INSTALL_DIR)/$(BIN)"
	@echo "✓ Desinstalado $(INSTALL_DIR)/$(BIN)"

clean:
	@rm -f "$(BIN)"

test:
	bun run test

tidy:
	bun install --frozen-lockfile
