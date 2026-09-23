#!/usr/bin/env python3
"""
Script de limpeza: remove do Supabase todas as vagas cujo application_link
contenha 'himalayas.app' ou 'himalayas.com'.

Uso: python3 cleanup_himalayas_jobs.py
"""
import urllib.request
import json
import os
import sys

SUPABASE_URL = (
    os.environ.get("SUPABASE_URL")
    or os.environ.get(
        "NEXT_PUBLIC_SUPABASE_URL",
        "https://ffxpsothavxbrdhshtoj.supabase.co",
    )
)
SUPABASE_KEY = (
    os.environ.get("SUPABASE_ANON_KEY")
    or os.environ.get(
        "NEXT_PUBLIC_SUPABASE_ANON_KEY",
        "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZmeHBzb3RoYXZ4YnJkaHNodG9qIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTAwODMxNzUsImV4cCI6MjEwNTY1OTE3NX0.kSHFcIGN8l0GZz4lHrNHJHo87_3gAvXKtobneTrQ43A",
    )
)


def list_himalayas_ids():
    """Busca IDs das vagas com application_link contendo 'himalayas'."""
    url = (
        f"{SUPABASE_URL}/rest/v1/jobs"
        "?select=id,title,company,application_link"
        "&application_link=ilike.%25himalayas.app%25"
        "&limit=1000"
    )
    req = urllib.request.Request(
        url,
        headers={"apikey": SUPABASE_KEY, "Authorization": f"Bearer {SUPABASE_KEY}"},
    )
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            return json.loads(resp.read().decode())
    except Exception as e:
        print(f"[ERRO] Falha ao listar vagas: {e}")
        return []


def delete_jobs_by_ids(ids):
    """Deleta em lote as vagas pelos IDs fornecidos."""
    if not ids:
        return 0
    id_list = ",".join(f'"{i}"' for i in ids)
    url = f"{SUPABASE_URL}/rest/v1/jobs?id=in.({id_list})"
    req = urllib.request.Request(
        url,
        method="DELETE",
        headers={
            "apikey": SUPABASE_KEY,
            "Authorization": f"Bearer {SUPABASE_KEY}",
            "Prefer": "return=minimal",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            return len(ids)
    except urllib.error.HTTPError as e:
        print(f"[AVISO] HTTP {e.code} ao deletar (pode ser falta de policy DELETE): {e.read().decode()}")
        return 0
    except Exception as e:
        print(f"[ERRO] Falha ao deletar: {e}")
        return 0


def main():
    print("=" * 60)
    print("Limpeza de vagas do Himalayas no Supabase")
    print("=" * 60)

    rows = list_himalayas_ids()
    print(f"Encontradas {len(rows)} vagas com 'himalayas.app' no link:")
    for r in rows[:10]:
        print(f"  - [{r.get('id')}] {r.get('title')} @ {r.get('company')}")
    if len(rows) > 10:
        print(f"  ... e mais {len(rows) - 10}")

    if not rows:
        print("Nada a deletar. Banco já está limpo.")
        return

    confirm = input(f"\nConfirmar exclusão de {len(rows)} vagas? (s/N): ").strip().lower()
    if confirm != "s":
        print("Operação cancelada pelo usuário.")
        return

    ids = [r["id"] for r in rows]
    deleted = delete_jobs_by_ids(ids)
    print(f"\nResultado: {deleted} vagas removidas do Supabase.")

    if deleted == 0 and len(ids) > 0:
        print("\nA política RLS pode estar bloqueando DELETE via REST API.")
        print("Solução alternativa: rodar o SQL diretamente no painel do Supabase:")
        print("  DELETE FROM jobs WHERE application_link ILIKE '%himalayas.app%';")


if __name__ == "__main__":
    main()
