# Rasmboz AI

Uzbekcha prompt bilan AI rasm generatsiya qiladigan oddiy va chiroyli sayt.

## Cloudflare Pages Deploy

1. GitHub repo'ni Cloudflare Pages'ga ulang.
2. Build command ni bo'sh qoldiring.
3. Build output directory: `public`
4. Environment Variables ichiga quyidagilarni qo'shing:
5. `HF_TOKEN=...`
6. `HF_IMAGE_MODEL=black-forest-labs/FLUX.1-schnell`
7. `HF_PROVIDER=hf-inference`

## Lokal Ishga Tushirish

1. `.env` yarating yoki mavjudini tahrir qiling.
2. `.env` ichiga `HF_TOKEN=...` yozing.
3. `npm start`
4. Brauzerda `http://localhost:8788/home` yoki terminal ko'rsatgan local manzilni oching.

## Xususiyatlar

- Uzbekcha prompt yuborish
- Hugging Face image generation bilan 1 ta rasm olish
- Har foydalanuvchi uchun authsiz alohida limit
- 24 soatda 2 ta limit brauzer bo'yicha avtomatik reset bo'ladi
- API key frontendga chiqmaydi
- Cloudflare Pages Functions bilan ishlaydi
