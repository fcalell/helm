{
  description = "helm dev shell — SolidJS + Vite kanban orchestrator (linked to ../stack)";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    flake-utils.url = "github:numtide/flake-utils";
  };

  outputs =
    { nixpkgs, flake-utils, ... }:
    flake-utils.lib.eachDefaultSystem (
      system:
      let
        pkgs = nixpkgs.legacyPackages.${system};
      in
      {
        devShells.default = pkgs.mkShell {
          packages = [
            # engines.node is ">=24"; the `stack` CLI + Vite 7 run under it.
            pkgs.nodejs_24
            # No packageManager pin in package.json — use nixpkgs pnpm directly.
            pkgs.pnpm

            # Formatter — biome.json drives `pnpm check`; nvim resolves it on PATH.
            pkgs.biome

            # Project LSP servers — nvim's vim.lsp.enable picks these up on PATH.
            pkgs.vtsls # TypeScript / SolidJS TSX
            pkgs.vscode-langservers-extracted # cssls, html, jsonls
            pkgs.tailwindcss-language-server # tailwindcss v4
          ];

          shellHook = ''
            echo "helm dev shell: node $(node --version), pnpm $(pnpm --version)"
            [ -f helm.config.json ] || echo "note: no helm.config.json yet — copy helm.config.example.json"
          '';
        };
      }
    );
}
