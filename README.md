# MBPG Online — Sistem Semakan Tundaan

Laman semakan tundaan/klamp kenderaan untuk Majlis Bandaraya Pasir Gudang (MBPG).

## Seni bina

```
Browser (GitHub Pages)  →  Cloudflare Worker (proxy)  →  ITCS Backend
```

- Semua panggilan API melalui proxy — tiada token atau kredensial di sisi klien.
- Token API disimpan sebagai *encrypted secret* dalam Cloudflare Worker.
- Tiada mod demo: rekod tidak ditemui bermakna tiada rekod dalam pangkalan data.

## Aliran semakan

1. Pengguna masukkan no. pendaftaran kenderaan
2. Sistem membuat carian: clamps → towing-operations → tow-assignments
3. Rekod ditemui → modal dipaparkan dengan butiran kes
4. Tiada rekod → mesej "Rekod tidak ditemui"
5. Ralat sistem → mesej ralat mesra beserta talian MBPG

## Pembangunan

Laman statik — buka `index.html` atau serve folder ini dengan mana-mana web server.
