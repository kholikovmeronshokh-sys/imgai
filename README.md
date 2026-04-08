# Rasmboz AI

Uzbekcha prompt bilan AI rasm generatsiya qiladigan oddiy va chiroyli sayt.

## Ishga tushirish

1. `.env` yarating yoki mavjudini tahrir qiling.
2. `.env` ichiga `HF_TOKEN=...` yozing.
3. Tavsiya etilgan default: `HF_IMAGE_MODEL=black-forest-labs/FLUX.1-schnell` va `HF_PROVIDER=hf-inference`.
4. `npm start` ishga tushiring.
5. Brauzerda `http://localhost:3000/home` yoki `http://localhost:3000/generate` oching.

## Xususiyatlar

- Uzbekcha prompt yuborish
- Hugging Face image generation bilan 1 ta rasm olish
- Har foydalanuvchi uchun authsiz alohida limit
- 24 soatda 2 ta limit avtomatik reset bo'ladi
- API key frontendga chiqmaydi
