# Nexo Sourcing v2

ეს არის მარტივი Sourcing CRM, რომელიც მუშაობს იმავე Supabase პროექტზე, სადაც Orders Nexo გაქვთ,
მაგრამ იყენებს მხოლოდ `sourcing_*` ცხრილებს.

## Supabase-ში უკვე უნდა არსებობდეს
- sourcing_users
- sourcing_companies
- sourcing_suppliers
- sourcing_requests
- sourcing_request_items
- sourcing_activity_log

თქვენი login მომხმარებელი უნდა იყოს `sourcing_users` ცხრილში `active = true`.

## ლოკალურად გაშვება
1. ამოარქივეთ ZIP.
2. გაუშვით `npm install`
3. `.env.example` დააკოპირეთ `.env.local` სახელით.
4. ჩაწერეთ არსებული Supabase პროექტის:
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
5. გაუშვით `npm run dev`

## Vercel
Vercel Project Settings → Environment Variables:
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`

შემდეგ Deploy.

## ფუნქციები
- Email/password Login
- sourcing_users-ით წვდომის კონტროლი
- Dashboard
- Companies
- Suppliers
- Requests
- ერთ Request-ში ბევრი ნივთი
- Supplier status
- China Price / Client Price
- MOQ
- წარმოების ვადა
- Supplier/Internal/Client comments
- Activity Log
- მობილურზე ადაპტირებული მარტივი UI

## პირველი ვერსია განზრახ მარტივია
- ერთ ნივთზე ერთი აქტიური Supplier
- ფაილის პირდაპირ ატვირთვის ნაცვლად URL
- Supplier portal ჯერ არ არის
- Client quote portal ჯერ არ არის
- WhatsApp / WeChat ავტომატიზაცია ჯერ არ არის
