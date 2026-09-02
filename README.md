# SKYGGEBY

Et originalt norsk multiplayer crime/economy-spill for nettleser.
Alt spilleren ser er på bokmål. Kode og dokumentasjon er på engelsk.

> Status: **fundament + kriminalitetsloop + byen + informasjon + ferdigheter +
> eiendeler + inventar + kontakter**. Auth, økonomi, kriminalitet, distrikter,
> informasjon, ferdigheter, eiendeler, inventar, kontakter og dashbord er på
> plass. Øvrige spillsystemer (fraksjoner, territorier, firma, marked osv.) er
> bevisst ikke bygget ennå.

## Arkitektur

```
skyggeby/
├─ shared/          Delte typer, konstanter, formatering og progresjonsmatte
│  └─ src/          assets · constants · contacts · crimes · districts
│                   information · skills · game · types · format · vitals
├─ server/          Node + Express + TypeScript (autoritativ)
│  ├─ prisma/       schema.prisma (Player, Session, Transaction, CrimeAttempt)
│  └─ src/
│     ├─ config/    Miljøvariabler
│     ├─ db/        Prisma-klient
│     ├─ lib/       Feil, passord, tokens, validering, serialisering
│     ├─ middleware/ auth · error · rateLimit
│     ├─ modules/   auth · session · player · economy · crime · city
│     │             information · skills · assets · inventory · contacts
│     └─ routes/    API-rot
└─ client/          React + Vite + TypeScript + Tailwind
   └─ src/
      ├─ nav/       navigation.tsx - kategorimenyen, ett sted
      ├─ layouts/   GameLayout - sidebar, statuslinje og <Outlet/>
      ├─ pages/     én side per kategori
      ├─ components/ gjenbrukbare paneler og kort
      ├─ api/       endepunkter og feilhåndtering
      └─ state/     AuthContext
```

**Serveren er autoritativ.** Klienten sender aldri penger, XP, helse eller heat.
All pengeflytting går gjennom `applyLedgerEntries()` i
`server/src/modules/economy/transaction.service.ts`, som:

1. tar radlås på spilleren (`SELECT ... FOR UPDATE`),
2. kjører alt i én databasetransaksjon,
3. nekter negativ saldo og saldo over taket,
4. skriver én uforanderlig `Transaction`-rad per bevegelse.

Ingen annen kode har lov til å oppdatere `cash` eller `bankBalance`.

### Kriminalitet

Klienten sender kun `POST /api/kriminalitet/<id>` — ingen tall, ingen utfall.
Serveren kontrollerer nivå, avkjøling, energi og helse, triller terningen med
`crypto`, beregner belønning, bokfører pengene, gir XP, oppdaterer nivå, heat og
helse — alt i én databasetransaksjon med radlås.

Hele balansen ligger i [`shared/src/crimes.ts`](shared/src/crimes.ts): navn,
beskrivelse, nivåkrav, energikostnad, avkjøling, suksess-sjanse, XP, utbytte,
heat og helsekonsekvenser. Det er det eneste stedet tallene justeres.

Passiv regenerering (energi opp, heat ned) ligger i
[`shared/src/vitals.ts`](shared/src/vitals.ts) og gjøres opp lat: serveren
settler den akkumulerte tiden ved hver forespørsel, uten bakgrunnsjobber.

### Byen

Byen er ren data i [`shared/src/districts.ts`](shared/src/districts.ts). Hvert
distrikt beskrives av tre vurderinger på skalaen 1–5, der 3 er bysnittet:

| Distrikt | Politi | Risiko | Aktivitet |
| --- | --- | --- | --- |
| Sentrum | 4 | 2 | 4 |
| Havna | 2 | 4 | 3 |
| Industrien | 3 | 4 | 2 |
| Neon | 3 | 3 | 5 |
| Blokkene | 1 | 3 | 3 |
| Regjeringskvartalet | 5 | 5 | 2 |

Alle gameplay-modifikatorer **utledes** av disse tre tallene i
`districtModifiers()` — de listes aldri opp for hånd:

| Vurdering | Påvirker |
| --- | --- |
| Politi ↑ | sjanse ↓, heat ↑ |
| Aktivitet ↑ | utbytte ↑, XP ↑ |
| Risiko ↑ | bot ↑, skade ↑ |

Å legge til et distrikt er derfor én oppføring i katalogen: ingen migrering,
ingen endring i kjernelogikken, og ingen mulighet for å skrive inn en
usammenhengende bonusliste. Vektene justeres ett sted, i `DISTRICT_WEIGHTS`.

Kriminalitetstjenesten er den eneste konsumenten så langt, og den bruker
[`crime.modifiers.ts`](server/src/modules/crime/crime.modifiers.ts) — det
eneste stedet distriktsmatte møter kriminalitetstall. Distriktet leses alltid
fra den låste databaseraden, aldri fra forespørselen.

## Kom i gang

```bash
npm run setup
```

Start PostgreSQL (Docker):

```bash
docker compose up -d
```

Opprett tabellene (den første migreringen ligger klar i
`server/prisma/migrations/`):

```bash
npm run db:migrate
```

Start alt (shared-watch + API + frontend):

```bash
npm run dev
```

- Frontend: http://localhost:5173
- API: http://localhost:4000/api
- Helsesjekk: http://localhost:4000/api/health

## Miljøvariabler

`server/.env` (kopiert fra `server/.env.example`):

| Variabel        | Standard                                   | Forklaring                          |
| --------------- | ------------------------------------------ | ----------------------------------- |
| `DATABASE_URL`  | `postgresql://postgres:postgres@localhost:5432/skyggeby` | PostgreSQL-tilkobling  |
| `PORT`          | `4000`                                     | API-port                            |
| `CLIENT_ORIGIN` | `http://localhost:5173`                    | Tillatt CORS-origin                 |
| `COOKIE_SECURE` | `false`                                    | Sett `true` bak HTTPS i produksjon  |
| `TRUST_PROXY`   | `0`                                        | Antall reverse proxyer foran API-et |
| `HOST`          | `0.0.0.0`                                  | Grensesnittet serveren binder seg til |
| `SERVE_CLIENT`  | `true` i produksjon                        | Om API-prosessen også serverer `client/dist` |
| `PUBLIC_APP_URL`| tom                                        | Offentlig adresse, kun til oppstartsloggen |

Skyggeby bruker **ugjennomsiktige økt-tokens lagret i databasen**, ikke signerte
cookies. Det finnes derfor ingen `SESSION_SECRET` å sette — økten er en rad i
`sessions`, og cookien bærer bare et tilfeldig token.

> `TRUST_PROXY` må kun settes høyere enn 0 hvis det faktisk står en proxy foran
> serveren som skriver `X-Forwarded-For`. Ellers kan klienter forfalske headeren
> og gi seg selv en ny rate limit-kvote for hver forespørsel.

## API

| Metode | Sti                          | Beskrivelse                       |
| ------ | ---------------------------- | --------------------------------- |
| GET    | `/api/helse`                 | Helsesjekk                        |
| POST   | `/api/auth/registrer`        | Opprett spiller + logg inn        |
| POST   | `/api/auth/logg-inn`         | Logg inn                          |
| POST   | `/api/auth/logg-ut`          | Logg ut                           |
| GET    | `/api/auth/meg`              | Gjeldende spiller                 |
| GET    | `/api/spiller/profil`        | Fersk spillerprofil               |
| GET    | `/api/spiller/transaksjoner` | Transaksjonshistorikk (cursor)    |
| POST   | `/api/spiller/bank/innskudd` | Sett kontanter inn på konto       |
| POST   | `/api/spiller/bank/uttak`    | Ta ut fra konto (2 % gebyr)       |
| GET    | `/api/kriminalitet`          | Katalog med tilstand for spilleren |
| POST   | `/api/kriminalitet/:crimeId` | Utfør en kriminalitet             |
| GET    | `/api/by`                    | Bykartet med spillerens posisjon  |
| POST   | `/api/by/flytt`              | Flytt til et annet distrikt       |
| GET    | `/api/informasjon`           | All informasjon spilleren eier    |
| POST   | `/api/informasjon/utforsk`   | Utforsk distriktet du står i      |
| GET    | `/api/informasjon/:id`       | Én informasjon, kun for eieren    |
| GET    | `/api/ferdigheter`           | Alle seks ferdigheter og poeng    |
| POST   | `/api/ferdigheter/oppgrader` | Bruk ett poeng på én ferdighet    |
| GET    | `/api/eiendeler`             | Eiendelene spilleren eier         |
| GET    | `/api/eiendeler/katalog`     | Kjøpbare typer med metadata       |
| POST   | `/api/eiendeler/kjop`        | Kjøp én eiendel                   |
| POST   | `/api/eiendeler/selg`        | Selg én eiendel                   |
| GET    | `/api/inventar`              | Båret og lagret, med plassbruk    |
| POST   | `/api/inventar/legg-inn`     | Legg én eiendel i inventaret      |
| POST   | `/api/inventar/ta-ut`        | Ta én eiendel ut av inventaret    |
| GET    | `/api/kontakter`             | Kontaktene spilleren kjenner      |
| GET    | `/api/kontakter/:contactId`  | Én kontakt, kun for den som kjenner den |
| POST   | `/api/kontakter/oppdag`      | Bli kjent med noen nye            |
| POST   | `/api/kontakter/kontakt`     | Ta en prat, +1 tillit             |

Sesjoner er serverside og lagres i databasen. Klienten holder kun en opak,
`httpOnly`-cookie (`skyggeby_sid`, 7 dagers levetid).

### Informasjon

Informasjon er konkrete kunnskapsbiter, ikke en tallverdi. Hver bit er en egen
rad med type, kilde, relevans, distrikt, pålitelighet, alder og verdi — og en
intern `isTrue` som **aldri** serialiseres. Katalogen og all matematikk ligger i
[`shared/src/information.ts`](shared/src/information.ts).

| Type | Vekt | Pålitelighet | Levetid | Bonusvekt |
| --- | --- | --- | --- | --- |
| Rykte | 45 | 25–60 | 90 min | 0,50 |
| Observasjon | 30 | 55–85 | 3 t | 0,75 |
| Kontakt | 13 | 45–80 | 4 t | 0,80 |
| Etterretning | 9 | 75–95 | 6 t | 1,00 |
| Hemmelighet | 3 | 40–90 | 12 t | 1,00 |

**Oppdagelse.** `POST /api/informasjon/utforsk` koster 3 energi og har 5
minutters avkjøling. Serveren leser distriktet fra den låste spillerraden;
klienten sender ingenting. Sjansen for å finne noe stiger med distriktets
aktivitet (0,20–0,85).

**Ferskhet** utledes av `discoveredAt`/`expiresAt`/`usedAt`: FERSK under 35 % av
levetiden, så GAMMEL, UTDATERT etter utløp, UTBRUKT når den er brukt.
Informasjon slettes aldri automatisk — den blir bare mindre verdt.

**Pålitelighet** er 0–100, avgjort av serveren og håndhevet av en `CHECK` i
databasen. Den korrelerer med sannsynligheten for at informasjonen faktisk
stemmer (35 % + 60 % × pålitelighet), men avgjør den aldri: en sikker påstand
kan være feil, og en vag kan stemme.

**Effekt på kriminalitet.** Serveren finner den mest nyttige ubrukte biten som
er relevant for jobben og gjelder distriktet, hevder den med en betinget
`usedAt IS NULL`-oppdatering, og legger til bonusen:

```
bonus = 15 × bonusvekt(type) × pålitelighet/100 × ferskhetsfaktor
```

Maks 15 prosentpoeng, og kriminalitetstaket på 95 % gjelder fortsatt etterpå.
Informasjon som viser seg å være feil blir brukt opp uten å gi noe. Relevans
avgjør hva som hjelper hva — `MULIGHET` hjelper alt, resten er koblet til
bestemte jobber.

### Ferdigheter

Seks ferdigheter, alle med tak på nivå 25, definert i
[`shared/src/skills.ts`](shared/src/skills.ts). XP bestemmer fortsatt
spillernivået alene — ferdigheter er en helt egen akse.

| Ferdighet | Effekt i v1 |
| --- | --- |
| Etterretning | Finner mer og bedre informasjon, og får mer ut av den |
| Kriminalitet | Bedre odds på jobber |
| Motstandskraft | Mindre skade og tap når en jobb går galt |
| Forretning | Lavere bankgebyr — beregnet, men ikke i bruk ennå |
| Mobilitet | Raskere forflytning — beregnet, men ikke i bruk ennå |
| Sosial | Bedre kontakter — beregnet, men ikke i bruk ennå |

**Ferdighetspoeng** kommer av å gå opp i nivå, og tildeles av samme skriv som
setter det nye nivået — de kan derfor aldri komme i utakt:

| Nivå | Poeng per nivå | Totalt |
| --- | --- | --- |
| 2–10 | +2 | 18 ved nivå 10 |
| 11–20 | +1 | 28 ved nivå 20 |
| 21+ | 0 | 28 |

**Diminishing returns.** Hvert nivå gir en andel av det som er igjen:
`kurve(n) = (1 − 0,9ⁿ) / (1 − 0,9²⁵)`. Nivå 1 gir 10,8 % av full effekt, nivå 5
gir 44 %, nivå 13 gir 80 %, nivå 25 gir 100 %. Første nivå er altså verdt tolv
ganger mer enn det siste.

Alle effekter går gjennom `cap × kurve(nivå)` i
[`skill.effects.ts`](server/src/modules/skills/skill.effects.ts) — det eneste
stedet et ferdighetsnivå blir til et gameplay-tall. Det gjør takene absolutte:
uansett hva som ligger i databasen kan ingen effekt overstige sitt tak, og nivå
0 gir alltid nøyaktig null. Informasjonens +15-tak og kriminalitetens 95 %-tak
gjelder fortsatt oppå alt sammen.

### Eiendeler

Ting spilleren eier, som faktiske rader. Katalogen med 20 typer i fire
kategorier ligger i [`shared/src/assets.ts`](shared/src/assets.ts) — det finnes
ingen `AssetType`-tabell, så en ny type er én oppføring og ingen migrering.

Tallene kopieres over på raden ved kjøp. En eiendel du allerede eier endrer seg
derfor ikke om katalogen senere balanseres.

| Felt | Bestemmes av |
| --- | --- |
| Pris | Serverens katalog — klienten sender kun `assetTypeId` |
| Sted | Spillerens `currentDistrictId` fra den låste raden |
| Tilstand | Starter på 100. Ingen automatisk slitasje i v1 |
| Salgsverdi | `floor(kjøpspris × 0,80 × tilstand/100)` |

Kjøp og salg går gjennom `applyLedgerEntriesTx` som alt annet, i én transaksjon
med radlås. Salget bruker en betinget `deleteMany` som selve kravet: bare den
som faktisk fjernet raden får betalt, så to samtidige salg kan ikke begge
lykkes.

`calculateMaintenanceDue()` finnes som ren funksjon, men **ingenting trekker
vedlikehold i v1** — ingen cron, ingen automatisk slitasje. Den er der så et
senere driftssystem har én definisjon å bygge på.

Statusregler: `ACTIVE` og `STORED` kan selges; `DAMAGED` og `SEIZED` kan ikke.
Verken reparasjon eller beslag er bygget.

### Inventar

Inventaret er **ikke** en egen tabell. En eiendel er én rad, og om den bæres er
ett felt på den raden — så ingenting kan dupliseres eller komme i utakt med hva
spilleren faktisk eier.

Tre begreper holdes strengt adskilt på `Asset`:

| Felt | Betyr |
| --- | --- |
| `location` | hvilket distrikt eiendelen står i |
| `status` | tilstanden (ACTIVE, STORED, DAMAGED, SEIZED) |
| `storageLocation` | om den bæres (INVENTORY) eller ikke (STORED) |

En eiendel kan være i Sentrum, ACTIVE og i inventaret samtidig. Å bære noe
flytter det ikke: flytter spilleren til Havna, blir eiendelen stående der den er.

**Kapasitet** er 10 plasser (`INVENTORY_CAPACITY`). Plasskostnaden leses fra
katalogen, ikke fra raden — hvor mye plass en ting tar er en regel om bæring,
ikke en egenskap ved det enkelte objektet. Kjøretøy kan ikke bæres i det hele
tatt.

`calculateInventoryUsage()` er det eneste stedet forbruk regnes ut. Kapasiteten
sjekkes under spillerens radlås, og skrivingen er i tillegg betinget av at
eiendelen faktisk ligger utenfor inventaret — så to samtidige forespørsler om
den siste plassen kan aldri begge lykkes.

Kjøp legger aldri noe i inventaret automatisk; spilleren må velge det selv.

### Kontakter

18 navngitte personer fordelt på seks roller og alle seks distrikter, i
[`shared/src/contacts.ts`](shared/src/contacts.ts). Det finnes ingen
kontakttabell: databasen lagrer bare *relasjonen* mellom spiller og kontakt, så
en ny person er én katalogoppføring og ingen migrering. `contactId` valideres
server-side mot katalogen.

Kontakter gir **tilgang**, ikke prosentbonuser. Ingenting her påvirker
kriminalitet, informasjon eller ferdigheter i v1.

**Tillit** går 0–100, starter på 10 ved oppdagelse og øker med 1 per samtale.
All endring går gjennom `adjustTrust()`, som klamper i begge ender.

| Tillit | Forhold |
| --- | --- |
| 0–19 | Ukjent |
| 20–39 | Bekjent |
| 40–59 | Kontakt |
| 60–79 | Betrodd |
| 80–100 | Nær kontakt |

**Oppdagelse** leser spillerens distrikt fra den låste raden og prioriterer folk
derfra; når distriktet er tomt utvides søket til resten av byen. Den koster
hverken penger, energi eller XP. Unik-constrainten på `(playerId, contactId)` er
garantien: en spiller kan aldri kjenne samme person to ganger.

**`reliability`** (0–100) er en egenskap ved personen, ikke ved relasjonen. Den
lagres, men serialiseres aldri til klienten — ingenting konsumerer den i v1.

### Virksomheter

Noe spilleren eier **og driver**. En eiendel er en ting du eier; en virksomhet
har inntekt, driftskostnad og sin egen konto. Derfor er `Business` en egen
modell og ikke en `Asset`-rad — det er to forskjellige domener.

Katalogen med seks typer ligger i
[`shared/src/businesses.ts`](shared/src/businesses.ts). Det finnes ingen
`BusinessType`-tabell, så en ny type er én oppføring og ingen migrering.

| Virksomhet | Distrikt | Pris | Netto per dag |
| --- | --- | --- | --- |
| Nærbutikk | Blokkene | 200 000 | +1 250 |
| Verksted | Havna | 350 000 | +2 000 |
| Drosjesentral | Sentrum | 500 000 | +2 750 |
| Nattklubb | Neon | 750 000 | +5 000 |
| Lagerfirma | Industrien | 900 000 | +5 000 |
| Konsulentselskap | Regjeringskvartalet | 1 500 000 | +8 000 |

Maks **3 virksomheter** per spiller. Grensen håndheves server-side under
spillerens radlås, så tjue samtidige kjøp gir nøyaktig ett.

Klienten sender kun `businessTypeId` og et navn (3–32 tegn, trimmet og
normalisert av serveren). Pris, distrikt, rater, tilstand, aktivitet og risiko
leses fra katalogen.

**Oppgjør er lat.** Det finnes ingen cron-jobb og ingen daglige rader:

```
netto = gulv(medgått tid × (inntekt − driftskostnad) / 86 400)
```

Oppgjøret kjøres når virksomhetene leses eller det tas ut penger, alltid under
radlås — to samtidige forespørsler krediterer derfor nøyaktig én gang. Maks
**7 dager** (`MAX_SETTLEMENT_DAYS`) akkumuleres; er spilleren borte i tretti,
betales sju. En delvis krone går ikke tapt: tidsstempelet flyttes bare så langt
som kronene faktisk dekker, så hyppige oppdateringer runder ikke bort inntekten.

Penger blir spillerens først ved **uttak**, som tømmer driftskontoen og
krediterer kontanter gjennom `applyLedgerEntriesTx` i samme transaksjon. Selve
nullstillingen er kravet: bare den forespørselen som faktisk flyttet raden får
betalt.

| Transaksjonstype | Når |
| --- | --- |
| `VIRKSOMHET_KJOP` | Ved kjøp |
| `VIRKSOMHET_UTTAK` | Når penger flyttes fra virksomheten til spilleren |

Oppgjør skriver **aldri** en transaksjonsrad — det er intern akkumulering.

`condition`, `activity` og `risk` lagres og vises, men påvirker ingenting i v1.
`totalValue` er kun et estimat: `kjøpspris × tilstand/100`, aldri
driftskontoen.

### Meldinger

Private meldinger mellom spillere. Enkeltmeldinger, ikke tråder: det finnes
ingen samtalemodell i v1, og ingenting grupperer meldinger sammen.

| Felt | Regel |
| --- | --- |
| Emne | 1–100 tegn etter trimming |
| Innhold | 1–5000 tegn etter trimming |
| Avsender | Alltid den innloggede spilleren |
| Mottaker | Må finnes, og kan aldri være deg selv |

Klienten sender kun `recipientId`, `subject` og `content`. Zod-skjemaet
beskriver ingen `senderId`, `readAt` eller tidsstempler, så slike felt faller
bort før tjenestelaget ser dem. CHECK-constraints i databasen avviser tomme,
whitespace-only og for lange meldinger uansett hvilken kodesti som skriver dem,
og `senderId <> recipientId` er en skranke, ikke bare en regel i koden.

**Lest** settes med én betinget `UPDATE` som er scoped til mottakeren og til
`readAt: null`. Tjue samtidige markeringer gir derfor én skriving og ett
tidsstempel; ingen lås trengs, fordi det ikke finnes en lesning etterfulgt av en
skriving å beskytte. Kun mottakeren kan markere.

**Sletting** fjerner ingenting. Hver part eier sitt eget tidsstempel —
`senderDeletedAt` og `recipientDeletedAt` — og skriver kun sin egen kolonne, så
avsender og mottaker kan slette samtidig uten å miste hverandres oppdatering.
Når begge har slettet, blir raden liggende, usynlig for begge.

**Eierskap** håndheves i `where`-klausulen, ikke i en etterkontroll: en melding
du ikke er part i svarer nøyaktig som en som ikke finnes (404). Avsender og
mottaker serialiseres kun med `id` og `username` — en melding er aldri en vei
inn til en annen spillers kontanter, nivå eller posisjon.

Innboks og sendt-boks er cursor-paginert (25 per side, maks 50). Lista bærer et
kort utdrag; hele teksten hentes først når meldingen faktisk åpnes.

| Endepunkt | Grense |
| --- | --- |
| `POST /api/meldinger/send` | 20/min |
| `GET /api/meldinger*` | 60/min |
| `POST /api/meldinger/:id/les` | 60/min |
| `POST /api/meldinger/:id/slett` | 30/min |

Grensene er per konto, ikke per adresse: to spillere på samme nett deler ikke
kvote, og én spiller får ikke ny kvote ved å bytte nettverk.

Klienten viser alltid innhold som ren tekst. `dangerouslySetInnerHTML` brukes
ingen steder i prosjektet.

### Spillerprofiler

Player *er* profilen. Det finnes ingen egen profiltabell og ingen migrering:
systemet er en smal, eksplisitt lesevei inn i data som allerede fantes.

**Offentlig profil** bygges fra en `select` som aldri laster de private
kolonnene i det hele tatt — kontanter, bank, helse, heat, ferdighetspoeng og
passordhash er ikke filtrert bort etterpå, de er aldri hentet. Den bruker med
vilje *ikke* `toPlayerDto`; den bærer alt dette, og gjenbruk her ville satt hver
enkelt av dem én glemt `delete` unna å bli sendt ut.

| Offentlig | Privat |
| --- | --- |
| Brukernavn, nivå, total XP | Kontanter og bank |
| Rykte og ryktebetegnelse | Helse, heat, energi |
| Distrikt (slått opp i bykatalogen) | Ferdighetspoeng og ferdigheter |
| Medlem siden | XP inn i nivået |
| Antall virksomheter og eiendeler | Hvilke virksomheter og eiendeler |
| | Meldinger, kontakter, informasjon |

Tellingene kommer fra databasen i samme spørring (`_count`), aldri fra
klienten. Detaljer — navn på virksomheter, inntekter, kjøpspriser, tilstand,
risiko — er ikke med i v1.

**Brukernavn er identifikatoren.** `/spiller/:username` slår opp mot
`usernameLower`, som er unik, så «Sjefen», «sjefen» og «SJEFEN» er samme person.
Et navn ingen har svarer nøyaktig som et ugyldig ett: 404, uten å si noe om hva
som finnes. En intern id fungerer ikke som brukernavn.

**Søk** matcher `usernameLower` med maks 10 treff. Termen escapes for `%`, `_`
og backslash før den blir et LIKE-mønster, så et søk på «%» finner de spillerne
som heter «%» — ingen — og ikke en tilfeldig del av byen.

| Endepunkt | Grense |
| --- | --- |
| `GET /api/spillere/:username` | 120/min |
| `GET /api/spillere/sok?sok=` | 60/min |

Grensene er per konto. Begge endepunktene krever innlogging: «offentlig» betyr
offentlig for byen, ikke for internett.

Profilen har **[Send melding]**, som åpner det eksisterende meldingssystemet med
mottakeren ferdig valgt. Din egen profil har den ikke — du skriver ikke brev til
deg selv. Brukernavn i meldingslister og meldingsvisning lenker til
`/spiller/:username`; interne id-er havner aldri i en URL.

### Kjøretøy

Det som skiller kjøretøy fra alt annet du eier: **spillerens distrikt og
kjøretøyets distrikt er to separate, server-eide tilstander**. Å flytte deg selv
flytter ingen bil, og å kjøre en bil flytter ikke deg.

| Felt | Betyr |
| --- | --- |
| `Player.currentDistrictId` | hvor spilleren er |
| `Vehicle.locationDistrictId` | hvor kjøretøyet er |
| `Vehicle.isActive` | om spilleren kjører det |
| `Asset` | hva tingen er verdt, hva den kostet, hvilken tilstand den er i |

Katalogen er ikke en ny katalog: `VEHICLE_TYPES` i
[`shared/src/vehicles.ts`](shared/src/vehicles.ts) er de fem oppføringene i
`assets.ts` med kategori VEHICLE, så prisene har ett hjem og kan ikke drive fra
hverandre.

**Kjøp** går gjennom den eksisterende eiendelstjenesten inne i samme
transaksjon: én ledger, én transaksjonsrad, ett sted penger kan bevege seg.
Klienten sender kun `vehicleTypeId` og et navn (3–32 tegn). Et kjøretøy kjøpt
fra *eiendelskatalogen* registreres på nøyaktig samme måte — ellers ville
maksgrensen vært mulig å omgå.

**Maks 5 kjøretøy** per spiller, håndhevet under spillerens radlås i den ene
kjøpsimplementasjonen begge veier deler.

**Aktivering** krever at kjøretøyet står der spilleren står. Det gamle aktive
parkeres i samme transaksjon, og et partielt unikt indeks i databasen
(`ON vehicles (playerId) WHERE isActive`) nekter et andre aktivt kjøretøy uansett
hvilken kodesti som skriver.

**Flytting** krever eget, aktivt kjøretøy som står i spillerens distrikt.
Destinasjonen er det eneste klienten velger, og den valideres mot bykatalogen.
Etterpå står bilen i Neon og spilleren fremdeles i Blokkene — det er hele
poenget. v1 koster hverken penger eller energi.

**Salg** er eiendelssalget. `Vehicle.assetId` er unik og kaskaderer, så en solgt
bil kan ikke bli stående aktiv, eid eller igjen som en foreldreløs rad — og det
eksisterende `/api/eiendeler/selg` fungerer uendret.

| Endepunkt | Grense |
| --- | --- |
| `GET /api/kjoretoy*` | 120/min |
| `POST /api/kjoretoy/kjop` | 20/min |
| `POST /api/kjoretoy/{aktiver,park,flytt,selg}` | 30/min (felles) |

Grensene er per konto. **Mobilitet** er foreløpig kun en dokumentert
UI-indikasjon: ferdigheten påvirker ingenting i v1.

### Eiendom

Et sted du eier i byen, med en fast adresse. Eiendom er sin egen modell og ikke
en `Asset`: en eiendel er noe du bærer eller lagrer, en eiendom er en adresse —
og et armbåndsur har hverken distrikt, lagringsplass eller sikkerhetsnivå.

Katalogen med seks typer ligger i
[`shared/src/properties.ts`](shared/src/properties.ts). Ingen `PropertyType`-tabell.

| Eiendom | Distrikt | Pris | Lagring | Sikkerhet |
| --- | --- | --- | --- | --- |
| Rom i kollektiv | Blokkene | 25 000 | 5 | Svært lav |
| Liten leilighet | Blokkene | 100 000 | 10 | Lav |
| Sentrumsleilighet | Sentrum | 250 000 | 15 | Lav |
| Rekkehus | Havna | 500 000 | 25 | Middels |
| Moderne villa | Neon | 1 000 000 | 40 | Høy |
| Luksuseiendom | Regjeringskvartalet | 2 500 000 | 60 | Svært høy |

**Adressen er katalogens.** Står du i Neon og kjøper et rekkehus, ligger det i
Havna — spillerens distrikt påvirker ingenting, og en eiendom flytter seg aldri.

**Kjøpsprisen kopieres til raden**, og all verdi regnes fra den kopien:

```
nåverdi   = gulv(kjøpspris × tilstand / 100)
salgssum  = gulv(kjøpspris × 0,80 × tilstand / 100)
```

Det betyr at en senere rebalansering av katalogen ikke kan endre hva et sted
noen allerede eier er verdt. Ingen automatisk slitasje i v1.

**Maks 3 eiendommer** per spiller, håndhevet under spillerens radlås. Kjøp og
salg går gjennom `applyLedgerEntriesTx` som alt annet, med egne
transaksjonstyper `EIENDOM_KJOP` og `EIENDOM_SALG`. Salget sletter raden og
krediterer i samme transaksjon: nekter hovedboken — for eksempel ved
formuestaket — står eiendommen der fortsatt.

`storageCapacity` og `security` **lagres og vises, men er koblet til
ingenting** i v1. De er fundamentet for et senere lager- og innbruddssystem;
Inventar er ikke rørt.

| Endepunkt | Grense |
| --- | --- |
| `GET /api/eiendom*` | 120/min |
| `POST /api/eiendom/kjop` | 20/min |
| `POST /api/eiendom/selg` | 30/min |

Grensene er per konto. Det finnes **ingen offentlig eiendomsvisning** i v1 — en
annen spillers eiendom svarer 404, og profilen viser ingen eiendomsdetaljer.

## Frontend-struktur

Dashboardet er en **oversikt**, ikke et samlested. Hvert system bor på sin egen
kategoriside bak én felles, beskyttet layout-rute:

| Rute | Kategori | Innhold |
| --- | --- | --- |
| `/dashbord` | Oversikt | Nøkkeltall, posisjon, siste aktivitet, hurtigknapper |
| `/byen` | Byen | Bykart, distrikter, flytting |
| `/gata` | Gata | Kriminalitet |
| `/informasjon` | Gata | Informasjon (undernavigasjon) |
| `/kjoretoy` | Gata | Kjøretøy: eie, aktivere, flytte, selge |
| `/okonomi` | Økonomi | Bank, kontanter, regnskap |
| `/eiendeler` | Økonomi | Eiendeler (undernavigasjon) |
| `/okonomi/inventar` | Økonomi | Inventar |
| `/okonomi/virksomheter` | Økonomi | Virksomheter |
| `/eiendom` | Økonomi | Eiendom: kjøpe, eie, se verdi, selge |
| `/okonomi/transaksjoner` | Økonomi | Full transaksjonshistorikk |
| `/meg` | Meg | Profil, status, økonomi, formue, spillersøk |
| `/spiller/:username` | Meg | Offentlig spillerprofil |
| `/meg/ferdigheter` | Meg | Ferdigheter (undernavigasjon) |
| `/meg/kontakter` | Meg | Kontakter |
| `/meg/statistikk` | Meg | Statistikk (plassholder) |
| `/meldinger` | Meldinger | Innboks, sendt, uleste, ny melding |
| `/innstillinger` | Innstillinger | Konto + plassholder |

Et nytt system blir en ny side pluss én oppføring i
[`client/src/nav/navigation.tsx`](client/src/nav/navigation.tsx) — aldri et
tillegg til en eksisterende side. Kategorier for systemer som ikke finnes ennå
hører ikke hjemme i den listen.

## Tester

Integrasjonstestene kjører mot den **ekte** PostgreSQL-databasen i
`server/.env`. Ingenting er mocket — poenget er å bevise at radlåsene og
transaksjonsisolasjonen holder under reell samtidighet.

```bash
npm test
```

| Kommando                 | Dekker                                                    |
| ------------------------ | --------------------------------------------------------- |
| `npm run test:db`        | Samtidighet, låsing, rollback, klientmanipulasjon          |
| `npm run test:city`      | Distrikter, flytting, modifikatorer, manipulasjon          |
| `npm run test:information` | Utforskning, ferskhet, bonus, rollback, manipulasjon     |
| `npm run test:skills`    | Poengkurve, oppgradering, samtidighet, effekttak          |
| `npm run test:assets`    | Katalog, kjøp, salg, statusregler, samtidighet, rollback  |
| `npm run test:inventory` | Kapasitet, bæring, eierskap, samtidighet, rollback        |
| `npm run test:contacts`  | Katalog, oppdagelse, tillit, eierskap, samtidighet        |
| `npm run test:businesses` | Katalog, kjøp, oppgjør, uttak, eierskap, samtidighet, rollback |
| `npm run test:messages`  | Sending, innboks, lesing, sletting, eierskap, samtidighet, rate limit |
| `npm run test:profile`   | Offentlig profil, søk, feltlekkasje, samtidighet, rate limit |
| `npm run test:vehicles`  | Katalog, kjøp, aktivering, parkering, flytting, salg, samtidighet, rollback |
| `npm run test:properties` | Katalog, kjøp, verdi, maks tre, salg, eierskap, samtidighet, rollback |
| `npm run test:deployment` | Helsesjekk, sikkerhetsheadere, feilhåndtering, miljø, migrasjoner |
| `npm run test:ratelimit` | Rate limiting over ekte HTTP (egen prosess, ren teller)    |

Testene oppretter kun spillere med prefikset `qa_` og rydder opp etter seg.
Rester fra en avbrutt kjøring fjernes automatisk ved neste start. Ekte kontoer
røres aldri.

## Staging på Railway

Staging kjører samme kodebase som localhost, i to miljøer:

```
GitHub  →  Railway
             ├── PostgreSQL (egen tjeneste)
             └── Skyggeby (én tjeneste)
                  ├── Express API på /api
                  └── bygget React-klient på /
```

**Én applikasjonstjeneste, ikke to.** Express serverer den bygde klienten fra
samme prosess og dermed samme origin. Det er derfor det ikke finnes CORS å
konfigurere i staging, og derfor øktcookien er førstepart. Klienten kaller
allerede `/api` relativt (`client/src/api/client.ts`), så ingen URL er
hardkodet noe sted.

### Kommandoer Railway kjører

| Fase | Kommando |
| --- | --- |
| Bygg | `npm ci --include=dev && npm run build:deploy` |
| Start | `npm run start` |

`build:deploy` genererer Prisma-klienten og bygger shared → server → klient.
`--include=dev` er ikke valgfritt: TypeScript, Vite og Prisma CLI ligger i
devDependencies, og med `NODE_ENV=production` ville npm hoppet over dem.

`start` kjører `prisma migrate deploy` og starter deretter
`server/dist/index.js`. Migreringen er idempotent og kjører i samme prosess som
serveren, før den lytter — det finnes ingen andre prosesser å kappløpe med så
lenge tjenesten har én instans.

### Variabler som må settes i Railway

| Variabel | Verdi |
| --- | --- |
| `DATABASE_URL` | `${{Postgres.DATABASE_URL}}` (referanse, ikke innlimt streng) |
| `NODE_ENV` | `production` |
| `COOKIE_SECURE` | `true` |
| `TRUST_PROXY` | `1` |
| `PUBLIC_APP_URL` | Railway-domenet, f.eks. `https://skyggeby-staging.up.railway.app` |

`PORT` setter Railway selv. `CLIENT_ORIGIN` skal **ikke** settes så lenge
frontend og API deler origin.

> `TRUST_PROXY=1` er riktig *fordi* Railway står foran med én proxy som legger
> den ekte klient-IP-en sist i `X-Forwarded-For`. Express leser da det siste
> leddet, og verdier klienten selv finner på ignoreres. Med `TRUST_PROXY=1`
> uten en slik proxy ville hvem som helst kunne gi seg selv en ny
> rate limit-kvote per forespørsel — derfor er standarden 0.

### Migrasjoner

| Miljø | Kommando |
| --- | --- |
| Utvikling | `npm run db:migrate` (`prisma migrate dev`) |
| Staging | `npm run start` kjører `prisma migrate deploy` automatisk |

**Aldri `prisma migrate reset` mot staging.** Den sletter databasen. Ny
migrasjon lages lokalt, committes, og anvendes av neste deploy.

### Helsesjekk og logger

`GET /api/health` svarer `{"status":"ok"}` uten innlogging og uten
databasespørring — Railway poller den, og en helsesjekk som rørte Postgres
ville tatt ned siden hver gang databasen blunket. `/api/helse` finnes fortsatt.

Logger leses i Railway-prosjektet under tjenesten → **Deployments** (byggelogg)
og **Logs** (kjøretidslogg). Oppstart logger port, miljø, om klienten serveres,
cookie-modus og antall proxy-hopp. Avslutning, migreringsfeil og uventede feil
logges også. Passordhasher, tokens, cookies og meldingsinnhold logges aldri.

### Restart

Railway → tjenesten → **Deployments** → *Restart*. Data ligger i
PostgreSQL-tjenesten og berøres ikke. Serveren håndterer `SIGTERM` ved å slutte
å ta imot nye tilkoblinger, la aktive forespørsler bli ferdige (maks 10
sekunder), koble fra Prisma og avslutte.

### Rate limiting i staging

Rate limiteren teller **i minnet, per instans**. Med én instans er det riktig.
Skaleres tjenesten horisontalt, får hver instans sin egen kvote, og en delt
teller (Redis eller tilsvarende) må på plass først. `numReplicas = 1` i
`railway.toml` er derfor et bevisst valg, ikke en tilfeldighet.

### Lokalt er uendret

`npm run dev` fungerer nøyaktig som før: Vite på 5173 med proxy til API-et på
4000, Docker Compose-Postgres, ingen Railway-variabler påkrevd. Alle nye
variabler har utviklingsvennlige standardverdier.

## Skript

| Kommando            | Gjør                                    |
| ------------------- | --------------------------------------- |
| `npm run setup`     | Installer, bygg shared, generer Prisma  |
| `npm run dev`       | Kjør alt i utviklingsmodus              |
| `npm run build`     | Bygg alle pakker                        |
| `npm run db:migrate`| Kjør Prisma-migrering                   |
| `npm run db:push`   | Push schema uten migreringsfil          |
| `npm run db:studio` | Åpne Prisma Studio                      |
| `npm test`          | Kjør integrasjonstestene mot databasen  |
| `npm run typecheck` | Typecheck av server (inkl. tester) og klient |
| `npm run build:deploy` | Prisma generate + full bygging (brukes av Railway) |
| `npm run start`     | Migrer og start produksjonsserveren      |
