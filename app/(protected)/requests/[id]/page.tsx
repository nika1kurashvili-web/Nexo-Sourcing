
import Link from "next/link";
import { notFound } from "next/navigation";
const previewByItemId = Object.fromEntries(
  items.map((item) => {
    if (!item.image_url) {
      return [item.id, ""];
    }
ეს?
კი, ზუსტად ეგ არის ახალი სწორი ვერსია — ეს დატოვე.

ახლა მოძებნე ფაილში კიდევ ერთხელ:

const previewByItemId

თუ მეორე ადგილასაც გამოჩნდება, ის მეორე ძველი ბლოკი უნდა წაშალო.

სწორი უნდა დარჩეს მხოლოდ ეს დასაწყისი:

const previewByItemId = Object.fromEntries(
  items.map((item) => {
    if (!item.image_url) {
      return [item.id, ""];
    }

თუ გინდა, ჩამიგდე ორივე ადგილი სადაც previewByItemId გიჩვენებს და გეტყვი ზუსტად რომელი წაშალო.

const previewByItemId = Object.fromEntries(previewEntries) as Record<string, string>;
  const referenceImageRows = items.length
  ? (
ეს?
კი, ეს არის ძველი ვერსია — ეს უნდა წაშალო.

ანუ ეს ნაწილი:

const previewByItemId = Object.fromEntries(previewEntries) as Record<string, string>;

const referenceImageRows = items.length
  ? (

აქედან მხოლოდ პირველი ხაზი წაშალე:

const previewByItemId = Object.fromEntries(previewEntries) as Record<string, string>;

const referenceImageRows = ... დატოვე.

თუ ზემოთ ჯერ კიდევ გაქვს ძველი const previewEntries = await Promise.all(...) ბლოკი, ისიც მთლიანად უნდა წაშალო.

საბოლოოდ ფაილში უნდა დარჩეს მხოლოდ ერთი previewByItemId — ის ახალი batch ვერსია, რომელიც signedUrlByPath-ს იყენებს.

ამის შემდეგ save → commit → Vercel build.

Running build in Washington, D.C., USA (East) – iad1
Build machine configuration: 2 cores, 8 GB
Cloning github.com/nika1kurashvili-web/Nexo-Sourcing (Branch: main, Commit: d706c3c)
Cloning completed: 606.000ms
Restored build cache from previous deployment (Dd5tgencJ8Ke8mf7wfLGDNDqb64F)
Running "vercel build"
Vercel CLI 61.1.0
Installing dependencies...
up to date in 698ms
7 packages are looking for funding
  run npm fund for details
Detected Next.js version: 15.5.26
Running "npm run build"
> nexo-sourcing@0.3.0 build
> next build
   ▲ Next.js 15.5.26
   Creating an optimized production build ...
Failed to compile.
./app/(protected)/requests/[id]/page.tsx
Module parse failed: Identifier 'referenceImageRows' has already been declared (108:10)
File was processed with these loaders:
 * ./node_modules/next/dist/build/webpack/loaders/next-flight-loader/index.js
 * ./node_modules/next/dist/build/webpack/loaders/next-swc-loader.js
You may need an additional loader to handle the result of these loaders.
|             url: signedUrlByPath[image.object_path] ?? ""
…
ზუსტად იგივე ტიპის პრობლემა დარჩა — ძველი referenceImageRows ბლოკიც ისევ ფაილშია.

page.tsx-ში მოძებნე:

const referenceImageRows = items.length

ეს არის ძველი ბლოკი და მთლიანად უნდა წაიშალოს.

წაშალე ამ ხაზიდან დაწყებული მთელი ნაწილი, სადაც შედის:

const referenceImageRows = items.length

შემდეგ:

const referenceImagePreviews = await Promise.all(

და შემდეგ ძველი:

const referenceImagesByItemId = Object.fromEntries(

ანუ ეს სამი ძველი ნაწილი მთლიანად წაშალე.

დატოვე მხოლოდ ახალი batch ვერსია, რომელიც იწყება ასე:

const itemIds = items.map((item) => item.id);

let referenceImageRows: any[] = [];
let supplierImages: any[] = [];

და ქვემოთ აქვს:

const referenceImagesByItemId: Record<

Commit-მდე Ctrl+F-ით შეამოწმე:

const referenceImageRows → 0
let referenceImageRows → 1
const referenceImagePreviews → 0
const previewEntries → 0
const referenceImagesByItemId → 1
const previewByItemId → 1
const supplierImagePreviews → 1
ეს გაწმენდა რომ გააკეთო, შემდეგ build-ზე იგივე duplicate error აღარ უნდა გადავიდეს სხვა ცვლადზე.

მოდი მთლიან ტექსტს მოგცემ მთლიანი ჩაასწორე და გამომიგზავნე
კი, ასე ჯობია — აღარ ვასწოროთ ნაწილ-ნაწილ.

ჩამიგდე მთლიანად ეს ფაილი:

app/(protected)/requests/[id]/page.tsx
შეგიძლია უბრალოდ ჩასვა აქ მთლიანად ან ფაილად ატვირთო.

მე:

ყველა duplicate ბლოკს გავწმენდ;
ახალ batch image loading-ს სწორად დავტოვებ;
5 reference image ფუნქციას შევინარჩუნებ;
Supplier Images-ს არ დავაზიანებ;
assignedSuppliers და დანარჩენ მიმდინარე ფუნქციებს შევინარჩუნებ;
დაგიბრუნებ მთლიან, გასწორებულ page.tsx-ს, რომ ძველი მთლიანად წაშალო და ახალი ჩასვა.

Pasted markdown.md
Code
წ

Worked for 1m 36s



მთლიანად გავასწორე page.tsx.

პრობლემა იყო ის, რომ ახალი batch image-loading ბლოკის შემდეგ ძველი referenceImageRows და referenceImagesByItemId ბლოკებიც ისევ დარჩენილი იყო, ამიტომ ცვლადები ორჯერ ცხადდებოდა. 

ეს ვერსია უკვე გაწმენდილია:

referenceImageRows მხოლოდ ერთხელაა
referenceImagesByItemId მხოლოდ ერთხელაა
previewByItemId მხოლოდ ერთხელაა
supplierImagePreviews მხოლოდ ერთხელაა
batch createSignedUrls() ოპტიმიზაცია დარჩა
5 reference image მხარდაჭერაც დარჩა
TypeScript syntax-იც შევამოწმე — syntax error არ აქვს
ჩამოტვირთე და მთლიანად ჩაანაცვლე არსებული:

შემდეგ:

ძველი app/(protected)/requests/[id]/page.tsx მთლიანად წაშალე
ამ ფაილის შიგთავსი ჩასვი
Save
Commit / Push
Vercel build გაუშვი
თუ ისევ Error იქნება, უკვე მხოლოდ build log-ის ზუსტ TypeScript error-ს მივყვებით. 


page_fixed.tsx
Code



  <div className="section-label">

    Product Images

  </div>



  <ReferenceImagesField

    requestId={request.id}

    requestItemId={item.id}

    legacyPath={item.image_url ?? ""}

    legacyPreviewUrl={

      previewByItemId[item.id] ?? ""

    }

    initialImages={

      referenceImagesByItemId[item.id] ?? []

    }

  />

</div>



              <button className="btn" type="submit">

                Save

              </button>

            </RequestItemForm>



            {supplierImagePreviews.some(image => image.request_item_id === item.id) && <div style={{ marginTop: 14 }}>

              <div className="section-label">Supplier Images</div>

              <div className="upload-controls">{supplierImagePreviews.filter(image => image.request_item_id === item.id).map(image => image.url ?

                <a key={image.id} href={image.url} target="\_blank" rel="noopener noreferrer" className="upload-preview-link"><img src={image.url} className="upload-preview" alt="Supplier uploaded image" /></a>

                : <span key={image.id} className="small muted">Image preview unavailable.</span>)}</div>

            </div>}



            <form action={deleteRequestItemAction} style={{ marginTop: 10 }}>

              <input type="hidden" name="id" value={item.id} />

              <input type="hidden" name="request_id" value={request.id} />

              <button className="btn danger" type="submit">

                Delete Item

              </button>

            </form>

            </div>

          </details>

        ))}

      </div>



      <div className="card" style={{ marginTop: 18 }}>

        <h2>Recent Activity</h2>

        <hr />



        {activities.length === 0 ? (

          <div className="empty">No activity yet.</div>

        ) : (

          <div className="stack">

            {activities.map((a: any) => (

              <div key={a.id}>

                <strong>{activityLabel(a.action)}</strong>

                {a.details ? ` · ${a.action === "request_status_changed" ? requestStatusLabel(a.details) : a.details}` : ""}

                <div className="small muted">

                  {new Date(a.created_at).toLocaleString("en-GB")}

                </div>

              </div>

            ))}

          </div>

        )}

      </div>

    </>

  );

}

