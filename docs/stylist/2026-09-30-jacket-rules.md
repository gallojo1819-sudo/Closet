# Jacket picking: classification, layering, fall/winter coverage, rotation (PROPOSED)

Read-only analysis, 2026-09-30 14:30 ET. Inputs: closet_meta snapshot `closet_meta_garments_2026-09-30.json` (fetched 2026-09-30 16:51:00.360093+00 UTC, 147 rows, 142 live), approved house profiles, `2026-09-30-proposed-stylist-rules.json`, `color-value-map.json`, prod sim rows `sim_b03aa4d/rows.json`. Nothing in the app, repo, Supabase or `/home/box/closet-ops` was changed. Code: `/workspace/jacket_scratch/` (`jacket_check.py` extends `stylist_check.py`; `build.py` rules+tests; `sim.py` picker; `write_out.py`).

Files: `2026-09-30-jacket-rules.json` (rules, same format as the proposed stylist rules, with tests and results), `2026-09-30-jacket-classification.json` (per-plate table), this file.

## TL;DR
- **Why card 1 is wrong, in rules:** JKT-LAY-1 bans a sport coat over any chunky knit, and the Acne grey knit is relaxed fit and warmth 4. JKT-LAY-3 bans light-wash jeans under a sport coat. Both are hard fails. The old XC-TEX-2 pass test used exactly this pairing, so JKT-LAY-1 replaces it.
- **Cards 2 and 3** fail JKT-COV-1 (on Weekday/Out in fall or winter, a jacket or coat is required, and a mid knit doesn't count). Card 2 also fails XC-TEX-3, because its sneaker is the Golden Goose pink suede star, not a white one.
- **Weekend decision:** a jacket is required in winter. In fall a missing jacket costs -15. That drops to -5 when the top is a heavy (warmth 4) chunky knit, and to 0 when the look has an outerwear-weight mid (cable cardigan, fleece, or puffer vest). Travel: required in winter, -10 in fall. Comfy: optional.
- **Tests:** 60/60 pass.
- **Simulation** over 108 house top-3 cards (5 contexts). Cards with no jacket: 93 before, 22 after. Of those, cards where a jacket is required: 57 before, 3 after (all 3 blocked by caps). Distinct jackets used: 6 before, 21 after, which covers all 21 season-eligible jackets. Cap violations after: 0.
- **Thin lists:** 545 and Faloni. Each has 3 brown-suede jackets sharing one T17 cap, and neither has a heavy jacket. Adding to them needs Joe to sign off on amending the 545-B4 and FAL-B4 bans.
- **Outer coats:** Joe owns none (no overcoat, topcoat, peacoat or parka). His winter pieces are the shearling bomber, the sherpa plaid jacket and the TNF toggle.

## 1. Classification
Counts: a) tailored sport coat/blazer: 4, b) casual jacket: 17, MID layer (not a jacket): 5 (26 plates: 24 filed as outerwear, plus the Khaki varsity and the Light blue denim overshirt from tops). **Outer coats: none.**

| id | name | filed as | class | subclass | cut | weight | seasons | houses now | houses after | over chunky knit | tee under | formality | notes |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| `g_whgv0gu6m08l` | Beige corduroy blazer | outerwear/blazer | a) tailored sport coat/blazer | soft/unstructured corduroy sport coat | tailored | mid | spring, fall, winter | polo, purple, faloni, 545, italiansummer, italianwinter | polo, purple, faloni, 545, italiansummer, italianwinter | no | weekend/travel only (-5) | 4 | THE ROW corduroy: softest tailoring Joe owns; plain tee OK on Weekend/Travel (-5). |
| `g_98p2sivflrxg` | Ivory double-breasted blazer | outerwear/blazer | a) tailored sport coat/blazer | structured sport coat (double-breasted) | tailored | mid | spring, summer, fall, winter | polo, purple, faloni, 545, italiansummer, italianwinter | polo, purple, faloni, 545, italiansummer, italianwinter | no | no | 5 | DB = structured, never a tee; winter only as winter-white on Out/Weekday. |
| `g_5josnvyoi4z9` | Navy blazer | outerwear/blazer | a) tailored sport coat/blazer | structured sport coat (navy blazer) | tailored | mid | spring, fall, winter | polo, italianwinter | polo, italianwinter | no | no | 5 | Structured; shirts, polos, fine knits only. |
| `g_juk45cokjxxy` | Taupe blazer | outerwear/blazer | a) tailored sport coat/blazer | soft/unstructured sport coat | tailored | mid | spring, fall, winter | polo, purple, faloni, 545, italiansummer, italianwinter | polo, purple, faloni, 545, italiansummer, italianwinter | no | weekend/travel only (-5) | 4 | Card 1 jacket. Approved profiles treat it as blazer_soft. Plain tee only on Weekend/Travel (-5). |
| `g_ed0ga2v0q2yo` | Beige zip jacket | outerwear/jacket | b) casual jacket | light zip blouson/harrington | close_light | light | spring, summer, fall | polo, faloni, italiansummer | polo, faloni, italiansummer | no | yes | 2 | warmth 2, light shell; never over a chunky knit; not a winter jacket. |
| `g_491tzu2suiv7` | Blue plaid shearling jacket | outerwear/jacket | b) casual jacket | sherpa/shearling-lined plaid denim jacket (trucker cut assumed) | waist | heavy | fall, winter | rrl, polo, purple, ald, sweetstable, italianwinter | rrl, polo, purple, ald, sweetstable, italianwinter | no (yes only if the knit is regular fit) | yes | 2 | Filed material=denim, warmth 3 but sherpa-lined: treated as heavy for season; waist cut, so over a chunky knit only when the knit is regular fit. |
| `g_8qqqzpwxuwti` | Brown chore jacket | outerwear/chore jacket | b) casual jacket | chore coat | roomy | mid | spring, fall, winter | rrl, polo, ald, sweetstable | rrl, polo, ald, sweetstable | yes | yes | 2 |  |
| `g_wwy9b2pusds3` | Brown shearling bomber jacket | outerwear/bomber jacket | b) casual jacket | shearling bomber | roomy | heavy | fall, winter | rrl, polo, purple, ald, sweetstable, italianwinter | rrl, polo, purple, ald, faloni (winter only), 545 (winter only), sweetstable, italianwinter | yes | yes | 3 | Heavy; Joe's best winter piece (no overcoat). Soft -5 in fall (late-fall piece). Counted separately from the brown-suede family. |
| `g_8od90wk1sl9k` | Brown suede bomber jacket | outerwear/bomber jacket | b) casual jacket | suede bomber | waist | mid | spring, fall, winter | rrl, polo, ald, faloni, 545, sweetstable, italianwinter | rrl, polo, ald, faloni, 545, sweetstable, italianwinter | no (yes only if the knit is regular fit) | yes | 3 | Brown-suede family (T17 cap). Bomber rib hem: chunky knit only if regular fit. |
| `g_py2swfwot1ed` | Brown suede jacket | outerwear/jacket | b) casual jacket | suede jacket (cut unknown; treated as waist-length) | waist | mid | spring, fall, winter | rrl, polo, purple, faloni, 545, sweetstable, italiansummer, italianwinter | rrl, polo, purple, faloni, 545, sweetstable, italiansummer, italianwinter | no (yes only if the knit is regular fit) | yes | 3 | Brown-suede family (T17 cap). |
| `g_1pg9y05mlkek` | Brown suede jacket | outerwear/field jacket | b) casual jacket | suede field jacket (REISS) | roomy | mid | spring, fall, winter | rrl, polo, purple, faloni, 545, sweetstable, italiansummer, italianwinter | rrl, polo, purple, faloni, 545, sweetstable, italiansummer, italianwinter | yes | yes | 3 | Brown-suede family (T17 cap). Field cut = roomy: the one suede jacket that goes over a chunky knit. |
| `g_j5og5jmzh5tx` | Khaki varsity | top/ | b) casual jacket | varsity jacket | waist | mid | spring, fall, winter | - | polo, ald | no (yes only if the knit is regular fit) | yes | 2 | MISFILED as top (blank subtype/material). Recategorise to outerwear / varsity jacket. Prod ships it as the top on PURPLE Weekend #2 with no shirt under it. |
| `g_vtbi91noucd3` | Light Blue denim jacket | outerwear/jacket | b) casual jacket | denim trucker | waist | light | spring, summer, fall | rrl, ald, sweetstable | rrl, ald, sweetstable | no (yes only if the knit is regular fit) | yes | 2 |  |
| `g_ulv8tgkujvjh` | Light blue denim jacket | outerwear/jacket | b) casual jacket | denim trucker | waist | light | spring, summer, fall | rrl, ald, sweetstable | rrl, ald, sweetstable | no (yes only if the knit is regular fit) | yes | 2 |  |
| `g_v7uvadckh79p` | Light blue denim overshirt | top/overshirt | b) casual jacket | denim overshirt / shirt-jacket (dual use) | close_light | light | spring, summer, fall | - | rrl, ald | no | yes | 2 | Filed as top/overshirt (correct); allow as a light outer over a tee/henley/fine knit. Never over a chunky knit. Denim wash rules (XC-DEN-1) apply. |
| `g_oyyiaxx6rls7` | Mint green field jacket | outerwear/jacket | b) casual jacket | field jacket (Polo RL, pastel) | roomy | light | spring, summer, fall | polo | polo | yes | yes | 2 | Pastel: spring/summer/early fall; counts in pastel budgets. |
| `g_3qjmw7n4wj2a` | Navy brown plaid jacket | outerwear/jacket | b) casual jacket | wool plaid jacket (shirt-jacket/shacket cut assumed) | roomy | mid | fall, winter | rrl, polo, ald, sweetstable | rrl, polo, ald, sweetstable | yes | yes | 3 | If this is actually a tailored tweed sport coat, move it to class a (then no chunky knits under it). |
| `g_qnmo5yzgl50b` | Navy field jacket | outerwear/field jacket | b) casual jacket | field jacket (Double RL) | roomy | mid | spring, fall, winter | rrl, polo, ald, sweetstable, italiansummer | rrl, polo, ald, sweetstable, italiansummer | yes | yes | 2 |  |
| `g_x4adkv9zu9yu` | Navy/black corduroy jacket | outerwear/jacket | b) casual jacket | corduroy jacket (trucker cut assumed) | waist | mid | spring, fall, winter | rrl, polo, purple, ald, sweetstable, italianwinter | rrl, polo, purple, ald, 545, sweetstable, italianwinter | no (yes only if the knit is regular fit) | yes | 3 |  |
| `g_sb0mc7s7v346` | Olive field jacket | outerwear/field jacket | b) casual jacket | field jacket | roomy | mid | spring, fall, winter | rrl, polo, ald, sweetstable, italiansummer | rrl, polo, ald, sweetstable, italiansummer | yes | yes | 2 |  |
| `g_5gfabeezh485` | White beige toggle jacket | outerwear/jacket | b) casual jacket | toggle jacket (The North Face; outdoor/fleece-style assumed) | roomy | mid | fall, winter | ald | ald | yes | yes | 1 | Name/brand suggest a sherpa or fleece toggle jacket; if it is a hip-length duffle coat it becomes Joe's only outer coat (class c). |
| `g_j2id379jo424` | Blue zip-up knit jacket | outerwear/zip jacket | MID layer (not a jacket) | full-zip knit (MID, filed as "zip jacket") |  | mid | spring, fall, winter | - | - | n/a (mid layer) |  |  | Filed outerwear/"zip jacket" but it is a knit: MID. Prod ships it as the ONLY upper layer (ALD #4, ALL #7, RRL Out #5, ALL Out #3, screenshot card 3): fine as the top layer, never counts as the jacket. |
| `g_xc4gr022xmvm` | Cream cable-knit cardigan | outerwear/cardigan | MID layer (not a jacket) | chunky cable cardigan (MID) |  | heavy | fall, winter | - | - | n/a (mid layer) |  |  | Outerwear-weight MID (warmth 4): waives the Weekend/Fall jacket penalty; chunky, so never under a sport coat or a waist-length jacket. |
| `g_k0mfejxiu5f8` | Cream printed fleece pullover | outerwear/fleece pullover | MID layer (not a jacket) | printed fleece pullover (MID) |  | heavy | fall, winter | - | - | n/a (mid layer) |  |  | Fleece: athletic layer, never under tailoring; outerwear-weight on Weekend/Fall. |
| `g_ef0u3ljnwa09` | Grey herringbone puffer vest | outerwear/vest | MID layer (not a jacket) | puffer vest / gilet (MID) |  | heavy | fall, winter | - | - | n/a (mid layer) |  |  | Vest: under chore/field/trucker/cord jackets; never under a sport coat. |
| `g_hhbz4ghpjmd1` | Navy ribbed zip sweater | outerwear/zip sweater | MID layer (not a jacket) | ribbed zip knit (MID) |  | mid | spring, fall, winter | - | - | n/a (mid layer) |  |  | Filed outerwear; knit MID. Prod ships it as the only upper layer (Faloni/IS/IW/ALL #4-#7). |

**Misfiled / data fixes (JKT-DATA-1, need Joe OK):**
- `g_j5og5jmzh5tx` Khaki varsity: filed `top/` -> b) casual jacket - varsity jacket
- `g_j2id379jo424` Blue zip-up knit jacket: filed `outerwear/zip jacket` -> MID layer (not a jacket) - full-zip knit (MID, filed as "zip jacket")
- `g_xc4gr022xmvm` Cream cable-knit cardigan: filed `outerwear/cardigan` -> MID layer (not a jacket) - chunky cable cardigan (MID)
- `g_k0mfejxiu5f8` Cream printed fleece pullover: filed `outerwear/fleece pullover` -> MID layer (not a jacket) - printed fleece pullover (MID)
- `g_ef0u3ljnwa09` Grey herringbone puffer vest: filed `outerwear/vest` -> MID layer (not a jacket) - puffer vest / gilet (MID)
- `g_hhbz4ghpjmd1` Navy ribbed zip sweater: filed `outerwear/zip sweater` -> MID layer (not a jacket) - ribbed zip knit (MID)
- Correction to the brief: in this snapshot the Blue zip-up knit jacket is filed as `outerwear/zip jacket`, not as a top. Prod ships it as the only upper layer, and it is the "blue half-zip knit" on screenshot card 3. The Khaki varsity is filed as a top, with blank subtype and material.

**Tops scanned for jacket-like names** (overshirt, shirt-jacket, shacket, gilet, vest, cardigan, varsity, jacket, bomber, coat, blazer, zip, fleece):

| id | name | subtype | verdict |
|---|---|---|---|
| `g_ugyaieefqcxe` | White knit cardigan | cardigan | MID knit (cardigan-as-outer): top layer only, never counts as a jacket |
| `g_j5og5jmzh5tx` | Khaki varsity |  | casual jacket (misfiled) |
| `g_v7uvadckh79p` | Light blue denim overshirt | overshirt | dual: top or light outer |
| `g_1khiworawkt7` | Light blue quarter-zip sweatshirt | quarter-zip sweatshirt | fleece/sweat top: not a jacket; athletic layer |
| `g_kp1ps7qww1ar` | Beige quarter-zip sweatshirt | sweatshirt | fleece/sweat top: not a jacket; athletic layer |
| `g_j1n1vh1wvbo4` | Grey half-zip fleece | half-zip sweatshirt | fleece/sweat top: not a jacket; athletic layer |
| `g_8m17f0l0tss9` | Light blue half-zip fleece | half-zip pullover | fleece/sweat top: not a jacket; athletic layer |
| `g_o739106dt8ym` | Cream abstract fleece half-zip | fleece pullover | fleece/sweat top: not a jacket; athletic layer |
| `g_dsqnx6ckt81v` | Beige quarter-zip sweatshirt | quarter-zip | fleece/sweat top: not a jacket; athletic layer |
| `g_jhyr10t2vo13` | Beige cable-knit half-zip sweater | half-zip sweater | zip knit: top layer, not a jacket |
| `g_3821acdhupu9` | Cream ribbed half-zip sweater | half-zip sweater | zip knit: top layer, not a jacket |
| `g_z8gvd1zvrcif` | Brown knit zip sweater | zip sweater | zip knit: top layer, not a jacket |
| `g_xuqvrfy5ocv4` | Olive zip-up knit sweater | zip sweater | zip knit: top layer, not a jacket |
| `g_rpjfgscii90r` | Cream fair isle half-zip sweater | sweater | zip knit: top layer, not a jacket |

No shacket, shirt-jacket or gilet is filed as a top. The only jacket-like tops are the Khaki varsity (a jacket) and the Light blue denim overshirt (either a top or a light outer). The White knit cardigan and the zip knits are mid knits.

## 2. Layering compatibility (machine-checkable)
Signals use the build.py match-spec on name | subtype | material, plus closet_meta `fit` and `warmth`. The full specs are under `shared_signals` in the JSON.

- **chunky_knit** (never under a sport coat): a keyword (cable, chunky, fisherman, aran, oversized, shawl, heavy knit, heavyweight knit, boucle, bouclé, mohair, fair isle, fairisle, textured sweater, popcorn, waffle knit, lopi, nordic), or any knit with warmth >= 4, or a sweater in relaxed/oversized fit. Joe's chunky knits: Grey knit sweater, Brown cable-knit sweater, Cream cable-knit cardigan, Cream cable-knit sweater, Beige cable-knit half-zip sweater, Cream ribbed half-zip sweater, Blue ivory diamond knit sweater, Beige ribbed sweater, Black cable-knit sweater, Beige textured sweater, Cream fair isle half-zip sweater.
- **fine_knit whitelist** (OK under a sport coat): merino, cashmere, fine-gauge, turtleneck, roll or mock neck, knit polo, collared sweater, knit shirt, and plain crew/knit sweaters that are regular fit with warmth <= 3. Joe's: Brown knit polo, Beige gradient sweater, Pale yellow ribbed polo, Beige crewneck sweater, Beige knit sweater, Burgundy collared sweater, Green herringbone knit shirt, Navy R sweater.
- **athletic_layer** (never under a sport coat): hoodie, sweatshirt (including the quarter-zip sweatshirts), fleece, track, puffer, vest, gilet.

| rule | what it says | severity |
|---|---|---|
| **JKT-LAY-1** no_chunky_or_athletic_under_sport_coat | A sport coat/blazer never goes over a chunky/oversized knit (signal chunky_knit: cable, chunky, fisherman, aran, oversized, shawl, heavy knit, boucle, mohair, fair isle, textured sweater; OR any knit with warmth >= 4; OR a relaxed/oversized-fit sweater) or an athletic layer (hoodie, sweatshirt incl. quarter-zip sweatshirts, fleece, track top, puffer/vest/gilet). Applies to top AND mid. Supersedes the XC-TEX-2 pass test (Grey knit sweater + Taupe blazer), which is exactly screenshot card 1. | hard |
| **JKT-LAY-2** sport_coat_underlayer_whitelist | Under a sport coat: collared woven shirts (dress/oxford/button-up/gingham/denim/chambray/flannel), polos and knit polos, fine/mid-gauge knits (fine_knit). Plain tee or henley only under a SOFT sport coat (tailored_soft: Taupe, Beige cord) and only on Weekend/Travel (-5); on Weekday/Out -15; under a STRUCTURED coat (Navy, Ivory DB) hard. Graphic/logo tee hard. Zip knit -10 (Weekend/Travel -5; 0 in IW/Purple/545, house exception JKT-HX-1). Non-chunky cardigan as mid -10. Camp/bowling shirt under a sport coat outside spring/summer -10. Anything unrated -5. | mixed |
| **JKT-LAY-3** sport_coat_bottoms | With a sport coat: wool/flannel/pleated trousers, chinos/cotton trousers and cords are fine. Jeans only DARK and clean (denim_wash >= 3). Light-wash, white, striped, distressed/frayed jeans: hard. Ecru or mid-wash clean jeans: -10 on Weekend/Travel, hard on Weekday/Out. Track/fleece/ribbed-knit lounge pants: hard. | hard |
| **JKT-LAY-4** sport_coat_shoes | With a sport coat: loafers, derbies, suede chukkas, dress boots OK. Athletic/fashion sneakers (GG, Gucci, NB, Nike, suede sneakers) hard (as XC-TEX-2). Clean white/cream leather sneaker: Weekend/Travel -5, Weekday/Out hard (tightens XC-TEX-2, which gave -5 everywhere). Mules -10 (-5 in summer). | hard |
| **JKT-LAY-5** casual_jacket_over_chunky_knit | Over a chunky knit (top or mid): ROOMY casual jackets/coats (chore, field incl. the REISS suede field jacket, wool plaid jacket, shearling bomber, toggle, parka, any overcoat) = OK. WAIST-length jackets (denim trucker, bomber, varsity, corduroy jacket, suede jacket of unknown cut, sherpa trucker) = OK only when the knit is regular fit; over a relaxed/oversized chunky knit the knit hangs below the rib/band hem = hard. CLOSE/LIGHT jackets (zip blouson, overshirt/shirt-jacket, anything warmth <= 2) = hard over any chunky knit. | hard |
| **JKT-LAY-6** mid_layers_are_not_jackets | Knits filed as outerwear (Cream cable-knit cardigan, Cream printed fleece pullover, Grey herringbone puffer vest, Blue zip-up knit jacket, Navy ribbed zip sweater) are MID layers: they may be the only upper layer, they go UNDER a jacket, and they never satisfy JKT-COV-1. Puffer vest / fleece never under tailoring (JKT-LAY-1). A vest or cardigan under a casual jacket is fine (chunky cardigan follows JKT-LAY-5). | hard |
| **JKT-LAY-7** faux_suit_casual | A casual jacket and trouser in the same fabric AND the same dominant colour (navy cord jacket + navy cords) read as an odd suit: -10. | soft -10 |
| **JKT-FORM-1** formality_spread_by_occasion | Score every piece 1-5 (formality_scale). Max spread (max - min) per occasion: Weekday 2, Out 2, Weekend 3, Travel 3, Comfy 2. Spread = max+1: -10; spread >= max+2: hard. Occasion gates: no sport coat on Comfy (hard); on Out a technical jacket (score 1) -15 and a utility jacket (score 2) -5; on Weekday a technical jacket -10. | mixed |
| **JKT-FORM-2** casual_jacket_trouser_coherence | A denim trucker, varsity or technical jacket over a tailored/pleated trouser mixes workwear with dress: -10. | soft -10 |
| **JKT-COV-1** jacket_required_fall_winter | A jacket or coat (class a/b/c; MID knits do not count) is REQUIRED on Weekday and Out in Fall and Winter (hard; supersedes XC-TEX-8 soft branch and generalises POLO-P7/PL-P1/IW-P1). WEEKEND (decision): Winter hard; Fall soft -15 when missing, reduced to -5 when the top/mid is a heavy chunky knit (warmth >= 4), waived (0) when the look has an outerwear-weight MID (cable cardigan, fleece pullover, puffer vest). Travel: Winter hard, Fall -10. Comfy: optional. Spring/Summer: optional. Weather override (optional, if the app passes live temp): >= 72F turns the Weekday/Out hard into -10. | hard |
| **JKT-COV-2** winter_outer_weight | Winter: a LIGHT outer (denim trucker, zip blouson, overshirt, mint field) with no mid = -15 (extends RRL-P7 to every house). A non-heavy outer with top+mid+outer warmth < 6 = -10 (Joe owns no overcoat; a blazer over a knit polo is under-dressed outdoors). | soft |
| **JKT-COV-3** jacket_season_eligibility | Heavy outers (shearling/sherpa, warmth >= 4): hard in spring/summer, -5 in fall (late-fall piece). Pastel outer (mint) in winter -10. Per-plate seasons are in 2026-09-30-jacket-classification.json and are used by the picker. | mixed |

**Formality scale (JKT-FORM-1)**; max spread: Weekday 2, Out 2, Weekend 3, Travel 3, Comfy 2.

| score | outer | top | bottom | shoe |
|---|---|---|---|---|
| 5 | structured sport coat (navy, DB) |  |  |  |
| 4 | soft sport coat (taupe, cord blazer); overcoat | dress shirt | tailored (pleated, pinstripe, wool/woven trouser) | leather/tassel/woven loafer |
| 3 | suede/leather, corduroy, wool plaid, shearling jacket | button-up/oxford, knit polo, LS polo, fine/mid-gauge knit | cotton trousers/chinos, cords | suede loafer |
| 2 | field, chore, trucker, varsity, zip blouson, overshirt | chunky or zip knit, flannel/denim/printed shirt, henley, camp/bowling, short-sleeve polo | jeans (dark, light, ecru) | boot, mule, clean leather sneaker |
| 1 | toggle/parka/fleece/vest | tee, sweatshirt, hoodie, fleece | distressed/frayed/white jeans, track/ribbed pants | athletic/fashion/suede sneaker |

**Which casual jackets go over a chunky knit (JKT-LAY-5):** yes (roomy cut): Brown chore, Olive field, Navy field, Mint field, REISS Brown suede *field* jacket `g_1pg9y05mlkek`, Navy brown plaid (wool), Brown shearling bomber, TNF toggle. Only over a **regular-fit** chunky knit (waist length): both Light blue denim truckers, Brown suede bomber, Brown suede jacket `g_py2swfwot1ed`, Navy/black corduroy jacket, Blue plaid shearling (sherpa trucker), Khaki varsity. Never: Beige zip jacket, denim overshirt, and all four sport coats.

**Supersedes:** the XC-TEX-2 pass test (it is card 1), the -5 for a clean sneaker under XC-TEX-2 (now JKT-LAY-4: -5 on weekend/travel, hard on weekday/out), XC-TEX-8 (now JKT-COV-1, hard), POLO-P7 (folded into COV-1), RRL-P7 (generalised as COV-2).

## 3. Fall/winter coverage and rotation
- **JKT-COV-1:** Weekday and Out, fall and winter: jacket required (hard). Weekend: required in winter. In fall, -15 when missing, -5 if the top is a heavy chunky knit (warmth 4), 0 with an outerwear-weight mid. Travel: required in winter, -10 in fall. Comfy: optional. Spring and summer: optional. Optional weather override: at 72F or above, the weekday/out hard becomes -10.
  - **Why this Weekend rule.** NYC weekends in October and November run 45-65F. A shirt or polo alone looks unfinished and is impractical, so -15 is enough to outrank the jacketless version whenever a legal jacket exists. A heavy chunky knit (Acne grey, cable crews, fair isle) is a legitimate outermost layer on a fall weekend, so it only takes -5. A true outerwear-weight mid (cable cardigan, fleece, puffer vest) is itself the layer, so no penalty. In winter nothing but a jacket or coat works outdoors, so it is hard. I kept fall soft rather than hard so that relaxed weekend cores with no legal jacket (for example hoodie-based looks, which cannot take tailoring) can still show, just ranked lower.
- **JKT-COV-2 (winter weight):** a light outer with no mid costs -15. Upper-body warmth (top + mid + outer) below 6 without a heavy outer costs -10.
- **JKT-COV-3:** heavy outers are hard in spring/summer and -5 in fall. A mint jacket in winter costs -10.
- **JKT-ROT-1** (row_jacket_cap): Inside one chip row: a jacket plate at most 2x per 8-card row and at most 1x in the top-3. Brown-suede family (g_1pg9y05mlkek, g_py2swfwot1ed, g_8od90wk1sl9k; T17 suede bridge cap) at most 1 per 6 consecutive looks (so <= 2 per 8-card row) and at most 1 in the top-3. Shearling bomber counts on its own.
- **JKT-ROT-2** (cross_chip_jacket_cap): Across all house chips' top-3 in one context: one jacket plate in at most 2 chips (mirrors XC-REP-1); brown-suede family in at most 3 chips.
- **JKT-ROT-3** (overuse_penalty): Rotation: for each context, mean = jacket cards / season-eligible jackets. A jacket already used more than the mean takes -5 per use above the mean when ranking the next card; a never-used eligible jacket gets +4.
- **JKT-ROT-4** (coverage_release_check): Release check: across the Fall and Winter house rows, every season-eligible jacket that is in at least one allowed_jackets list appears at least once. Missing plates are listed in the release report.
- **JKT-DATA-1** (recategorise): Recategorise Khaki varsity g_j5og5jmzh5tx top -> outerwear / subtype "varsity jacket". Keep Light blue denim overshirt g_v7uvadckh79p as top but flag outer_eligible. Blue zip-up knit jacket g_j2id379jo424: subtype "zip jacket" -> "zip-up knit" so no builder treats it as a jacket. Confirm the cut of Navy brown plaid jacket, Navy/black corduroy jacket, Brown suede jacket g_py2swfwot1ed and the TNF toggle jacket (fit field is blank or "regular").

### Thin allowed_jackets and proposed additions
| house | now | after | brown-suede now | fall effective now -> after | winter heavy now -> after | winter gate | verdict now | proposed additions |
|---|---|---|---|---|---|---|---|---|
| rrl | 12 | 13 | 3 | 10 -> 11 | 2 -> 2 | primary | ok | Light blue denim overshirt |
| polo | 16 | 17 | 3 | 14 -> 15 | 2 -> 2 | allowed | ok | Khaki varsity |
| purple | 8 | 8 | 2 | 7 -> 7 | 2 -> 2 | primary | ok | - |
| ald | 11 | 13 | 1 | 11 -> 13 | 2 -> 2 | primary | ok | Khaki varsity, Light blue denim overshirt |
| faloni | 7 | 8 | 3 | 5 -> 5 | 0 -> 1 | allowed | only 5 effective fall jackets (brown-suede family counts once); no heavy jacket for winter | Brown shearling bomber jacket (winter only) |
| 545 | 6 | 8 | 3 | 4 -> 5 | 0 -> 1 | primary | only 4 effective fall jackets (brown-suede family counts once); no heavy jacket for winter | Navy/black corduroy jacket, Brown shearling bomber jacket (winter only) |
| sweetstable | 12 | 12 | 3 | 10 -> 10 | 2 -> 2 | primary | ok | - |
| italiansummer | 8 | 8 | 2 | 7 -> 7 | 0 -> 0 | off | ok | - |
| italianwinter | 10 | 10 | 3 | 8 -> 8 | 2 -> 2 | primary | ok | - |

- **JKT-HX-1** (italianwinter, purple, 545): Italian zip-knit-under-blazer (Brunello/Cucinelli): a non-fleece, regular-fit zip knit under a sport coat is 0 instead of -10 in these houses.
- **RRL-JKT-A1** (rrl): Light blue denim overshirt as a light work outer over a tee/henley (XC-DEN-1 applies). No ban conflict.
- **POLO-JKT-A1** (polo): Khaki varsity: collegiate prep jacket. No ban conflict.
- **ALD-JKT-A1** (ald): Khaki varsity (collegiate street jacket, matches ALD collegiate_top) and Light blue denim overshirt as a light outer (XC-DEN-1 applies). No ban conflict.
- **FALONI-JKT-A1** (faloni): THIN in fall/winter: 7 jackets, 3 brown-suede family, 3 blazers, 1 light zip; nothing heavy. Add the Brown shearling bomber (brown/cream = Faloni palette) for winter only. Requires amending FAL-B4 (bans shearling) for winter only. Joe must approve.
- **545-JKT-A1** (545): THIN: 6 jackets, 3 of them the brown-suede family (one cap) and none heavy, while 545 is primary in fall AND winter. Add the Navy/black corduroy jacket (the dark, relaxed 545 palette) and the Brown shearling bomber for winter only. Requires amending 545-B4 (bans cord_jacket and shearling). Joe must approve.
- **IS-JKT-N1** (italiansummer): Winter is off for Italian Summer; fall list (8) is adequate. Mint green field jacket stays Polo-only (IS-B4/FAL-B4/ALD-B2/RRL-B8/SS-B4 all ban field_mint).
- Plates in only one house: the Mint green field jacket (Polo; every other house bans field_mint) and the TNF toggle (ALD). Both are left as they are.

## 4. Screenshot cards
### Card 1: Grey knit sweater + Taupe blazer + Light blue jeans + Brown suede loafers
Identified: Grey knit sweater (Acne Studios, relaxed, warmth 4) g_gp53xkrmem9b; Taupe blazer (Todd Snyder) g_juk45cokjxxy; Light blue jeans g_rvrs9hibr981 (twin plate g_fvc535elt23d is identical in data; same verdict); Brown suede loafers g_8ukg5mi9r3fc (espadrille-sole suede loafer in the image).
- weekday/fall: **FAIL** (0): JKT-LAY-1 hard: chunky/oversized knit Grey knit sweater under sport coat Taupe blazer; JKT-LAY-3 hard: light-wash jean Light blue jeans with a sport coat
- weekend/fall: **FAIL** (0): JKT-LAY-1 hard: chunky/oversized knit Grey knit sweater under sport coat Taupe blazer; JKT-LAY-3 hard: light-wash jean Light blue jeans with a sport coat

| alternative | look | context | result | jacket allowed in |
|---|---|---|---|---|
| A1 keep the sport coat: shirt + dark denim | Light blue dress shirt `g_2rtuat7aheik` + Taupe blazer `g_juk45cokjxxy` + Navy Blue/brown. Match Original Blue/brown. Match Original denim trousers `g_dzsh3qh7v6sb` + Brown suede loafers `g_8ukg5mi9r3fc` | weekday/fall | PASS (0) | 545, faloni, italiansummer, italianwinter, polo, purple |
| A2 keep the sport coat: knit polo + grey wool (IW/Purple formula) | Brown knit polo `g_bq9qnaa1vkon` + Taupe blazer `g_juk45cokjxxy` + Grey pleated trousers `g_bee1dg9rnfe5` + Brown suede loafers `g_8ukg5mi9r3fc` | weekday/fall | PASS (0) | 545, faloni, italiansummer, italianwinter, polo, purple |
| A3 keep the sport coat: navy LS polo + dark chinos | Navy long-sleeve polo `g_reesb6nbrmm4` + Taupe blazer `g_juk45cokjxxy` + Dark brown chinos `g_vf28ktbdhmtz` + Brown suede loafers `g_8ukg5mi9r3fc` | weekday/fall | PASS (0) | 545, faloni, italiansummer, italianwinter, polo, purple |
| B1 keep the chunky knit: REISS suede field jacket + dark denim | Grey knit sweater `g_gp53xkrmem9b` + Brown suede jacket `g_1pg9y05mlkek` + Navy Blue/brown. Match Original Blue/brown. Match Original denim trousers `g_dzsh3qh7v6sb` + Brown suede loafers `g_8ukg5mi9r3fc` | weekday/fall | PASS (0) | 545, faloni, italiansummer, italianwinter, polo, purple, rrl, sweetstable |
| B2 keep the chunky knit + light jeans (weekend): olive field jacket | Grey knit sweater `g_gp53xkrmem9b` + Olive field jacket `g_sb0mc7s7v346` + Light blue jeans `g_rvrs9hibr981` + Brown suede loafers `g_8ukg5mi9r3fc` | weekend/fall | PASS (0) | ald, italiansummer, polo, rrl, sweetstable |
| B3 winter: shearling bomber + navy cords | Grey knit sweater `g_gp53xkrmem9b` + Brown shearling bomber jacket `g_wwy9b2pusds3` + Navy corduroy trousers `g_v3ovns4bv344` + Brown suede loafers `g_8ukg5mi9r3fc` | weekday/winter | PASS (0) | 545, ald, faloni, italianwinter, polo, purple, rrl, sweetstable |

### Card 2: Burgundy collared sweater + Light grey pleated trousers + Pink suede star sneakers
Identified: Burgundy collared sweater (AMI) g_xbt3gpjuo1p4; Light grey pleated trousers g_k75fdfdsnak0 (twin g_yfkavdj5irwe identical except material); Pink suede star sneakers (Golden Goose) g_rxglifsoqobm (pink suede, white star, green tab in the image; not a white sneaker).
- weekday/fall: **FAIL** (-15): COL-9 soft -5: accents: red (Burgundy collared sweater); pink (Pink suede star sneakers) (one deep accent); XC-TEX-3 hard: tailored Light grey pleated trousers + athletic/fashion Pink suede star sneakers; JKT-FORM-1 soft -10: formality spread 3 (scores [3, 4, 1]) > 2 on weekday; JKT-COV-1 hard: Weekday/fall: no jacket or coat (mid knits do not count)
- weekend/fall: **LEGAL** (-30): COL-9 soft -5: accents: red (Burgundy collared sweater); pink (Pink suede star sneakers) (one deep accent); XC-TEX-3 soft -10: tailored Light grey pleated trousers + athletic/fashion Pink suede star sneakers (weekend); JKT-COV-1 soft -15: Weekend/fall: no jacket (strongly preferred)

| alternative | look | context | result | jacket allowed in |
|---|---|---|---|---|
| Add the REISS suede field jacket, swap GG for suede loafers | Burgundy collared sweater `g_xbt3gpjuo1p4` + Brown suede jacket `g_1pg9y05mlkek` + Light grey pleated trousers `g_k75fdfdsnak0` + Brown suede loafers `g_8ukg5mi9r3fc` | weekday/fall | PASS (0) | 545, faloni, italiansummer, italianwinter, polo, purple, rrl, sweetstable |
| Add the Taupe blazer + suede tassel loafers | Burgundy collared sweater `g_xbt3gpjuo1p4` + Taupe blazer `g_juk45cokjxxy` + Light grey pleated trousers `g_k75fdfdsnak0` + Brown suede tassel loafers `g_8nrtffa2s13s` | weekday/fall | PASS (0) | 545, faloni, italiansummer, italianwinter, polo, purple |
| Add the Olive field jacket + brown leather loafers (Polo/IS) | Burgundy collared sweater `g_xbt3gpjuo1p4` + Olive field jacket `g_sb0mc7s7v346` + Light grey pleated trousers `g_k75fdfdsnak0` + Brown leather loafers `g_om0dh5nps1ke` | weekday/fall | PASS (0) | ald, italiansummer, polo, rrl, sweetstable |
| Weekend: keep the GG sneakers, add the olive field jacket | Burgundy collared sweater `g_xbt3gpjuo1p4` + Olive field jacket `g_sb0mc7s7v346` + Light grey pleated trousers `g_k75fdfdsnak0` + Pink suede star sneakers `g_rxglifsoqobm` | weekend/fall | PASS (-15): COL-9 soft -5: accents: red (Burgundy collared sweater); pink (Pink suede star sneakers) (one deep accent); XC-TEX-3 soft -10: tailored Light grey pleated trousers + athletic/fashion Pink suede star sneakers (weekend) | ald, italiansummer, polo, rrl, sweetstable |

### Card 3: Blue zip-up knit jacket + Navy corduroy trousers + Brown leather boots
Identified: Blue zip-up knit jacket g_j2id379jo424 (filed outerwear/"zip jacket", really a knit MID); Navy corduroy trousers g_v3ovns4bv344 (plain navy, cord texture in the image); Brown leather boots g_b4zsf3dfrhdv (Joe's only boot, the dark lace-up in the image).
- weekday/fall: **FAIL** (0): JKT-COV-1 hard: Weekday/fall: no jacket or coat (mid knits do not count)
- weekend/fall: **LEGAL** (-15): JKT-COV-1 soft -15: Weekend/fall: no jacket (strongly preferred)

| alternative | look | context | result | jacket allowed in |
|---|---|---|---|---|
| Add the Brown chore jacket (RRL/SS/Polo/ALD) | Blue zip-up knit jacket `g_j2id379jo424` + Navy corduroy trousers `g_v3ovns4bv344` + Brown leather boots `g_b4zsf3dfrhdv` + Brown chore jacket `g_8qqqzpwxuwti` | weekday/fall | PASS (0) | ald, polo, rrl, sweetstable |
| Add the REISS suede field jacket | Blue zip-up knit jacket `g_j2id379jo424` + Navy corduroy trousers `g_v3ovns4bv344` + Brown leather boots `g_b4zsf3dfrhdv` + Brown suede jacket `g_1pg9y05mlkek` | weekday/fall | PASS (0) | 545, faloni, italiansummer, italianwinter, polo, purple, rrl, sweetstable |
| Add the Navy brown plaid jacket (SS/Polo/RRL) | Blue zip-up knit jacket `g_j2id379jo424` + Navy corduroy trousers `g_v3ovns4bv344` + Brown leather boots `g_b4zsf3dfrhdv` + Navy brown plaid jacket `g_3qjmw7n4wj2a` | weekday/fall | PASS (0) | ald, polo, rrl, sweetstable |
| Winter: Brown shearling bomber | Blue zip-up knit jacket `g_j2id379jo424` + Navy corduroy trousers `g_v3ovns4bv344` + Brown leather boots `g_b4zsf3dfrhdv` + Brown shearling bomber jacket `g_wwy9b2pusds3` | weekday/winter | PASS (0) | 545, ald, faloni, italianwinter, polo, purple, rrl, sweetstable |

Recommendations. **Card 1:** A1 (keep the taupe blazer, switch to the light blue dress shirt and the navy denim trousers) or B1 (keep the Acne knit, put the REISS suede field jacket over it, switch to dark denim). **Card 2:** add the REISS suede field jacket or the taupe blazer, and swap the Golden Goose sneakers for suede loafers. **Card 3:** add the brown chore jacket (RRL/SS/Polo), or the REISS suede jacket in the Italian houses.

## 5. Tests
**60/60 pass.** Every test runs through `J.evaluate_all` (the stylist rules plus the jacket rules; superseded branches are removed).

| rule | context | look | expected | result | hits for this rule |
|---|---|---|---|---|---|
| JKT-LAY-1 | weekday/fall | Grey knit sweater + Taupe blazer + Light blue jeans + Brown suede loafers (SCREENSHOT CARD 1: Acne grey knit (relaxed, warmth 4) under the Taupe blazer) | fail | PASS | JKT-LAY-1 hard: chunky/oversized knit Grey knit sweater under sport coat Taupe blazer |
| JKT-LAY-1 | weekday/fall | Black cable-knit sweater + Navy blazer + Grey pleated trousers + Brown leather loafers (Black cable-knit under the navy blazer) | fail | PASS | JKT-LAY-1 hard: chunky/oversized knit Black cable-knit sweater under sport coat Navy blazer |
| JKT-LAY-1 | weekday/fall | Blue ivory diamond knit sweater + Taupe blazer + Light grey pleated trousers + Brown suede loafers (prod ITALIANWINTER #1: relaxed diamond knit under the taupe blazer) | fail | PASS | JKT-LAY-1 hard: chunky/oversized knit Blue ivory diamond knit sweater under sport coat Taupe blazer |
| JKT-LAY-1 | weekday/fall | White button-up shirt + Grey herringbone puffer vest + Navy blazer + Grey pleated trousers + Brown leather loafers (puffer vest under a blazer) | fail | PASS | JKT-LAY-1 hard: Grey herringbone puffer vest (athletic/sweat/fleece/vest) under Navy blazer |
| JKT-LAY-1 | weekend/fall | Beige quarter-zip sweatshirt + Beige corduroy blazer + Navy Blue/brown. Match Original Blue/brown. Match Original denim trousers + Brown suede loafers (Rhude quarter-zip sweatshirt under the cord blazer) | fail | PASS | JKT-LAY-1 hard: Beige quarter-zip sweatshirt (athletic/sweat/fleece/vest) under Beige corduroy blazer |
| JKT-LAY-1 | weekday/fall | Brown knit polo + Taupe blazer + Grey pleated trousers + Brown suede loafers (Brown knit polo (fine) under the taupe blazer) | pass | PASS | - |
| JKT-LAY-1 | weekday/fall | Beige crewneck sweater + Navy blazer + Grey pleated trousers + Brown leather loafers (Beige crewneck sweater (regular, warmth 3) = mid-gauge whitelist) | pass | PASS | - |
| JKT-LAY-2 | weekday/fall | Light blue t-shirt + Navy blazer + Grey pleated trousers + Brown leather loafers (plain tee under the structured navy blazer) | fail | PASS | JKT-LAY-2 hard: tee/henley Light blue t-shirt under structured Navy blazer |
| JKT-LAY-2 | weekend/fall | Light blue t-shirt + Taupe blazer + Navy Blue/brown. Match Original Blue/brown. Match Original denim trousers + Brown suede loafers (plain tee under the soft taupe blazer on a weekend) | soft -5 | PASS | JKT-LAY-2 soft -5: plain tee/henley Light blue t-shirt under soft Taupe blazer (weekend) |
| JKT-LAY-2 | weekend/fall | White logo t-shirt + Beige corduroy blazer + Navy Blue/brown. Match Original Blue/brown. Match Original denim trousers + Brown suede loafers (Martine Rose logo tee under the cord blazer) | fail | PASS | JKT-LAY-2 hard: graphic/logo tee White logo t-shirt under a sport coat |
| JKT-LAY-2 | weekday/fall | Brown knit zip sweater + Navy blazer + Grey pleated trousers + Brown suede loafers (brown zip knit under the navy blazer) | soft -10 | PASS | JKT-LAY-2 soft -10: zip knit Brown knit zip sweater under Navy blazer reads sporty on weekday |
| JKT-LAY-2 | weekday/fall (italianwinter) | Brown knit zip sweater + Navy blazer + Grey pleated trousers + Brown suede loafers (same look in Italian Winter (JKT-HX-1)) | pass | PASS | - |
| JKT-LAY-2 | weekday/fall | Light blue dress shirt + Taupe blazer + Navy Blue/brown. Match Original Blue/brown. Match Original denim trousers + Brown suede loafers (card-1 fix A1: light blue dress shirt under taupe) | pass | PASS | - |
| JKT-LAY-3 | weekday/fall | Grey knit sweater + Taupe blazer + Light blue jeans + Brown suede loafers (SCREENSHOT CARD 1: light-wash jeans under the taupe blazer) | fail | PASS | JKT-LAY-3 hard: light-wash jean Light blue jeans with a sport coat |
| JKT-LAY-3 | weekend/fall | Navy long-sleeve polo + Navy blazer + Cream straight-leg jeans + Brown leather loafers (navy blazer + cream straight-leg jean on a weekend) | soft -10 | PASS | JKT-LAY-3 soft -10: ecru jean Cream straight-leg jeans with a sport coat (weekend) |
| JKT-LAY-3 | out/fall | Navy long-sleeve polo + Ivory double-breasted blazer + Cream straight-leg jeans + Black woven loafers (OUT_IVORY_DB_DENIM on Out with ecru jeans) | fail | PASS | JKT-LAY-3 hard: ecru jean Cream straight-leg jeans with a sport coat on out |
| JKT-LAY-3 | weekend/fall | White button-up shirt + Navy blazer + White distressed jeans + Brown leather loafers (white distressed jeans) | fail | PASS | JKT-LAY-3 hard: distressed/frayed White distressed jeans with a sport coat |
| JKT-LAY-3 | weekday/fall | White button-up shirt + Navy blazer + Brown frayed-hem pants + Brown leather loafers (frayed-hem pants) | fail | PASS | JKT-LAY-3 hard: distressed/frayed Brown frayed-hem pants with a sport coat |
| JKT-LAY-3 | weekday/fall | White button-up shirt + Navy blazer + Navy Blue/brown. Match Original Blue/brown. Match Original denim trousers + Brown leather loafers (navy denim trousers (dark, clean)) | pass | PASS | - |
| JKT-LAY-3 | weekday/fall | White button-up shirt + Navy blazer + Navy corduroy trousers + Brown leather loafers (cords) | pass | PASS | - |
| JKT-LAY-4 | weekend/fall | White button-up shirt + Navy blazer + Navy Blue/brown. Match Original Blue/brown. Match Original denim trousers + White leather sneakers (navy blazer + clean white sneaker on a weekend) | soft -5 | PASS | JKT-LAY-4 soft -5: clean leather sneaker White leather sneakers with a sport coat (weekend) |
| JKT-LAY-4 | weekday/fall | White button-up shirt + Navy blazer + Navy Blue/brown. Match Original Blue/brown. Match Original denim trousers + White leather sneakers (same on a weekday) | fail | PASS | JKT-LAY-4 hard: sneaker White leather sneakers with a sport coat on weekday |
| JKT-LAY-4 | weekend/fall | White button-up shirt + Taupe blazer + Navy Blue/brown. Match Original Blue/brown. Match Original denim trousers + Navy suede sneakers (navy suede sneakers) | fail | PASS | JKT-LAY-4 hard: athletic/fashion sneaker Navy suede sneakers with a sport coat |
| JKT-LAY-4 | weekend/fall | White button-up shirt + Taupe blazer + Navy Blue/brown. Match Original Blue/brown. Match Original denim trousers + Brown suede mules (mules under a sport coat in fall) | soft -10 | PASS | JKT-LAY-4 soft -10: mule Brown suede mules with a sport coat |
| JKT-LAY-4 | weekday/fall | White button-up shirt + Navy blazer + Navy Blue/brown. Match Original Blue/brown. Match Original denim trousers + Brown leather boots (boots with a blazer + dark denim) | pass | PASS | - |
| JKT-LAY-5 | weekday/fall | Grey knit sweater + Brown suede bomber jacket + Navy Blue/brown. Match Original Blue/brown. Match Original denim trousers + Brown suede loafers (suede bomber over the relaxed Acne knit) | fail | PASS | JKT-LAY-5 hard: waist-length Brown suede bomber jacket over relaxed/oversized chunky Grey knit sweater (knit hangs below the hem) |
| JKT-LAY-5 | weekday/fall | Black cable-knit sweater + Brown suede jacket + Light blue jeans + Brown leather tassel loafers (prod ITALIANWINTER #5: waist-length suede jacket over a relaxed black cable) | fail | PASS | JKT-LAY-5 hard: waist-length Brown suede jacket over relaxed/oversized chunky Black cable-knit sweater (knit hangs below the hem) |
| JKT-LAY-5 | weekend/fall | Black cable-knit sweater + Beige zip jacket + Navy Blue/brown. Match Original Blue/brown. Match Original denim trousers + Brown suede loafers (light zip blouson over a chunky cable) | fail | PASS | JKT-LAY-5 hard: light close-cut Beige zip jacket over chunky Black cable-knit sweater |
| JKT-LAY-5 | weekday/fall | Grey knit sweater + Brown suede jacket + Navy Blue/brown. Match Original Blue/brown. Match Original denim trousers + Brown suede loafers (card-1 fix B1: REISS suede FIELD jacket (roomy) over the Acne knit) | pass | PASS | - |
| JKT-LAY-5 | weekend/fall | Brown cable-knit sweater + Light Blue denim jacket + Navy corduroy trousers + Brown leather boots (regular-fit brown cable under a denim trucker) | pass | PASS | - |
| JKT-LAY-5 | weekday/winter | Grey knit sweater + Brown shearling bomber jacket + Navy Blue/brown. Match Original Blue/brown. Match Original denim trousers + Brown suede loafers (shearling bomber over the Acne knit in winter) | pass | PASS | - |
| JKT-LAY-6 | weekday/fall | Blue zip-up knit jacket + Navy corduroy trousers + Brown leather boots (SCREENSHOT CARD 3: the blue zip knit is a mid, so the card has no jacket (checked via JKT-COV-1)) | fail | PASS | JKT-COV-1 hard: Weekday/fall: no jacket or coat (mid knits do not count) |
| JKT-LAY-6 | weekday/winter | Blue plaid flannel shirt + Grey herringbone puffer vest + Brown chore jacket + Navy Blue/brown. Match Original Blue/brown. Match Original denim trousers + Brown leather boots (flannel + puffer vest + chore coat) | pass | PASS | - |
| JKT-LAY-7 | weekday/fall | Blue zip-up knit jacket + Navy/black corduroy jacket + Navy corduroy trousers + Brown leather boots | soft -10 | PASS | JKT-LAY-7 soft -10: Navy/black corduroy jacket + Navy corduroy trousers: same fabric and colour reads as an odd suit |
| JKT-LAY-7 | weekday/fall | Blue zip-up knit jacket + Brown chore jacket + Navy corduroy trousers + Brown leather boots (card-3 fix: brown chore over navy cords) | pass | PASS | - |
| JKT-FORM-1 | comfy/fall | Light blue t-shirt + Taupe blazer + Navy Blue/brown. Match Original Blue/brown. Match Original denim trousers + White leather sneakers (sport coat on Comfy) | fail | PASS | JKT-FORM-1 hard: sport coat on Comfy; JKT-FORM-1 soft -10: formality spread 3 (scores [4, 1, 2, 1]) > 2 on comfy |
| JKT-FORM-1 | weekday/fall | White logo t-shirt + Brown chore jacket + Navy pinstripe trousers + Brown leather tassel loafers (logo tee (1) + pinstripe (4) + tassel loafer (4): spread 3) | soft -10 | PASS | JKT-FORM-1 soft -10: formality spread 3 (scores [2, 1, 4, 4]) > 2 on weekday |
| JKT-FORM-1 | out/fall | White button-up shirt + White beige toggle jacket + Grey pleated trousers + Brown leather loafers (TNF toggle (1) with wool trousers and loafers (4) at dinner: spread 3 (-10) + technical outer (-15)) | soft -25 | PASS | JKT-FORM-1 soft -10: formality spread 3 (scores [1, 3, 4, 4]) > 2 on out; JKT-FORM-1 soft -15: technical/outdoor White beige toggle jacket at dinner |
| JKT-FORM-1 | out/fall | White button-up shirt + Navy blazer + Grey pleated trousers + Brown leather loafers (white shirt / navy blazer / grey wool / loafers) | pass | PASS | - |
| JKT-FORM-2 | weekday/fall | Burgundy collared sweater + Light Blue denim jacket + Light grey pleated trousers + Brown suede loafers | soft -10 | PASS | JKT-FORM-2 soft -10: Light Blue denim jacket (trucker/varsity/technical) over dress trouser Light grey pleated trousers |
| JKT-FORM-2 | weekday/fall | Burgundy collared sweater + Brown suede jacket + Light grey pleated trousers + Brown suede loafers (card-2 fix: suede field jacket) | pass | PASS | - |
| JKT-COV-1 | weekday/fall | Burgundy collared sweater + Light grey pleated trousers + Pink suede star sneakers (SCREENSHOT CARD 2: burgundy collared sweater, no jacket) | fail | PASS | JKT-COV-1 hard: Weekday/fall: no jacket or coat (mid knits do not count) |
| JKT-COV-1 | weekday/fall | Blue zip-up knit jacket + Navy corduroy trousers + Brown leather boots (SCREENSHOT CARD 3: blue zip knit (mid) + navy cords + boots, no jacket) | fail | PASS | JKT-COV-1 hard: Weekday/fall: no jacket or coat (mid knits do not count) |
| JKT-COV-1 | weekend/fall | Burgundy collared sweater + Light grey pleated trousers + Pink suede star sneakers (card 2 if it was a weekend card) | soft -15 | PASS | JKT-COV-1 soft -15: Weekend/fall: no jacket (strongly preferred) |
| JKT-COV-1 | out/fall | Blue zip-up knit jacket + Navy corduroy trousers + Brown leather boots | fail | PASS | JKT-COV-1 hard: Out/fall: no jacket or coat (mid knits do not count) |
| JKT-COV-1 | out/fall | Navy long-sleeve polo + Beige trousers + Brown suede loafers (prod FALONI Out #1 (was XC-TEX-8 soft)) | fail | PASS | JKT-COV-1 hard: Out/fall: no jacket or coat (mid knits do not count) |
| JKT-COV-1 | weekend/fall | Grey knit sweater + Navy Blue/brown. Match Original Blue/brown. Match Original denim trousers + Brown suede loafers (heavy Acne knit carries a fall weekend) | soft -5 | PASS | JKT-COV-1 soft -5: Weekend/fall: no jacket, heavy knit (warmth 4) carries it |
| JKT-COV-1 | weekend/fall | White button-up shirt + Cream cable-knit cardigan + Navy Blue/brown. Match Original Blue/brown. Match Original denim trousers + Brown suede loafers (white shirt under the cable cardigan (outerwear-weight mid)) | pass | PASS | - |
| JKT-COV-1 | weekend/winter | Grey knit sweater + Navy Blue/brown. Match Original Blue/brown. Match Original denim trousers + Brown suede loafers | fail | PASS | JKT-COV-1 hard: Weekend/winter: no jacket or coat |
| JKT-COV-1 | travel/winter | Grey knit sweater + Navy Blue/brown. Match Original Blue/brown. Match Original denim trousers + Brown suede loafers | fail | PASS | JKT-COV-1 hard: Travel/winter: no jacket or coat |
| JKT-COV-1 | comfy/winter | Black hoodie + Black fleece track pants + White leather sneakers | pass | PASS | - |
| JKT-COV-1 | weekday/fall | Burgundy collared sweater + Light grey pleated trousers + Brown suede loafers + Brown suede jacket (card-2 fix) | pass | PASS | - |
| JKT-COV-1 | weekday/fall | Blue zip-up knit jacket + Navy corduroy trousers + Brown leather boots + Brown chore jacket (card-3 fix) | pass | PASS | - |
| JKT-COV-2 | weekday/winter | Grey plaid shirt + Light Blue denim jacket + Navy Blue/brown. Match Original Blue/brown. Match Original denim trousers + Brown leather boots (prod RRL Weekday/Winter #1) | soft -15 | PASS | JKT-COV-2 soft -15: light outer Light Blue denim jacket alone in winter (add a vest/cardigan/zip knit or use a heavier jacket) |
| JKT-COV-2 | weekday/winter | Grey plaid shirt + Brown shearling bomber jacket + Navy Blue/brown. Match Original Blue/brown. Match Original denim trousers + Brown leather boots | pass | PASS | - |
| JKT-COV-2 | weekday/winter | Brown knit polo + Navy blazer + Grey pleated trousers + Brown suede loafers (knit polo (3) + blazer (2) = 5) | soft -10 | PASS | JKT-COV-2 soft -10: winter upper warmth 5 < 6 with Navy blazer (Joe owns no overcoat) |
| JKT-COV-3 | weekend/summer | White button-up shirt + Brown shearling bomber jacket + Navy Blue/brown. Match Original Blue/brown. Match Original denim trousers + Brown suede loafers | fail | PASS | JKT-COV-3 hard: heavy Brown shearling bomber jacket in summer |
| JKT-COV-3 | weekday/fall | White button-up shirt + Brown shearling bomber jacket + Navy Blue/brown. Match Original Blue/brown. Match Original denim trousers + Brown suede loafers | soft -5 | PASS | JKT-COV-3 soft -5: heavy Brown shearling bomber jacket in fall (late-fall piece) |
| JKT-COV-3 | weekday/fall | White button-up shirt + Olive field jacket + Navy Blue/brown. Match Original Blue/brown. Match Original denim trousers + Brown suede loafers | pass | PASS | - |
| JKT-HX-1 | weekday/fall (italianwinter) | Brown knit zip sweater + Navy blazer + Grey pleated trousers + Brown suede loafers | pass | PASS | - |

## 6. Simulation: jacket usage before vs after
Scope: the top-3 cards of the 9 house chips in all 5 sim contexts (108 cards; RRL, Purple, 545 and SS rows are short). The ALL row is excluded. **Before** = prod b03aa4d; the Khaki varsity counts as a top because that is how the app ships it. **After** = the same top/bottom/shoe cores with jackets re-picked by a greedy picker. The picker takes cards in order (all #1s, then #2s, then #3s). It honors allowed_jackets (with the proposed additions), per-plate seasons, the stylist rules plus JKT-LAY/FORM/COV (it rejects any jacket that adds a hard fail), JKT-ROT-1/2 caps and the JKT-ROT-3 overuse penalty. Ties are broken by a small house-signature and colour-contrast preference. A coverage pass (JKT-ROT-4) then swaps unused eligible jackets in where that is legal.

| metric | before | after |
|---|---|---|
| house top-3 cards | 108 | 108 |
| cards with a jacket | 15 | 86 |
| cards with NO jacket (all contexts) | 93 | 22 |
| no jacket, fall/winter contexts (of 87) | 75 | 4 |
| no jacket where one is REQUIRED (Weekday/Out fall+winter) | 57 | 3 |
| distinct jackets used | 6 | 21 |
| distinct jackets, fall/winter | 6 | 21 |
| cap violations (ROT-1/2) | 0 | 0 |

Per context (no-jacket cards / cards, distinct jackets):

| context | before | after |
|---|---|---|
| weekday/fall | 20/22, 2 distinct | 0/22, 16 distinct |
| out/fall | 18/23, 5 distinct | 1/23, 17 distinct |
| weekend/fall | 18/21, 3 distinct | 1/21, 16 distinct |
| weekday/winter | 19/21, 2 distinct | 2/21, 12 distinct |
| weekend/summer | 18/21, 3 distinct | 18/21, 3 distinct |

Per plate (uses across the 108 cards):

| jacket | id | before | after |
|---|---|---|---|
| Brown chore jacket | `g_8qqqzpwxuwti` | 2 | 8 |
| Navy field jacket | `g_qnmo5yzgl50b` | 3 | 7 |
| Navy/black corduroy jacket | `g_x4adkv9zu9yu` | 0 | 7 |
| Olive field jacket | `g_sb0mc7s7v346` | 1 | 7 |
| Brown suede jacket | `g_1pg9y05mlkek` | 0 | 6 |
| Khaki varsity | `g_j5og5jmzh5tx` | 0 | 6 |
| Navy brown plaid jacket | `g_3qjmw7n4wj2a` | 0 | 6 |
| Beige zip jacket | `g_ed0ga2v0q2yo` | 0 | 5 |
| Brown shearling bomber jacket | `g_wwy9b2pusds3` | 0 | 5 |
| Taupe blazer | `g_juk45cokjxxy` | 3 | 5 |
| Beige corduroy blazer | `g_whgv0gu6m08l` | 0 | 4 |
| Blue plaid shearling jacket | `g_491tzu2suiv7` | 0 | 3 |
| Brown suede bomber jacket | `g_8od90wk1sl9k` | 0 | 3 |
| Brown suede jacket | `g_py2swfwot1ed` | 1 | 3 |
| Navy blazer | `g_5josnvyoi4z9` | 0 | 3 |
| Light blue denim jacket | `g_ulv8tgkujvjh` | 0 | 2 |
| Mint green field jacket | `g_oyyiaxx6rls7` | 0 | 2 |
| Ivory double-breasted blazer | `g_98p2sivflrxg` | 0 | 1 |
| Light Blue denim jacket | `g_vtbi91noucd3` | 5 | 1 |
| Light blue denim overshirt | `g_v7uvadckh79p` | 0 | 1 |
| White beige toggle jacket | `g_5gfabeezh485` | 0 | 1 |

Jacketed prod cards that break the new layering rules: weekday/fall ITALIANWINTER #1 (Blue ivory diamond knit sweater + Light grey pleated trousers + Brown suede loafers + Taupe blazer): JKT-LAY-1: chunky/oversized knit Blue ivory diamond knit sweater under sport coat Taupe blazer; out/fall ITALIANWINTER #1 (Blue ivory diamond knit sweater + Light grey pleated trousers + Brown suede loafers + Taupe blazer): JKT-LAY-1: chunky/oversized knit Blue ivory diamond knit sweater under sport coat Taupe blazer; weekday/winter ITALIANWINTER #1 (Blue ivory diamond knit sweater + Light grey pleated trousers + Brown suede loafers + Taupe blazer): JKT-LAY-1: chunky/oversized knit Blue ivory diamond knit sweater under sport coat Taupe blazer.

Required but still no jacket after (all are cap-bound; the row builder should demote these cores or relax the cap for that context):
- out/fall 545 #3: Navy long-sleeve polo + Cream straight-leg jeans + Black woven loafers (compatible jackets exist but all are capped: Brown suede jacket, Brown suede jacket, Brown suede bomber jacket, Navy/black corduroy jacket)
- weekday/winter FALONI #3: Cream long-sleeve polo + Light blue jeans + Brown leather sneakers (compatible jackets exist but all are capped: Brown suede jacket, Brown suede jacket, Brown suede bomber jacket, Brown shearling bomber jacket)
- weekday/winter ITALIANSUMMER #3: Grey knit sweater + Sage pleated trousers + Grey and white low-top sneakers (compatible jackets exist but all are capped: Brown suede jacket, Navy field jacket, Olive field jacket)

Weekend/Summer stays mostly jacketless by design (optional). The picker never adds a jacket that creates a new hard fail.

<details><summary>All 108 cards: before -> after</summary>

| context | chip | # | core | before | after | need | soft hits after |
|---|---|---|---|---|---|---|---|
| weekday/fall | RRL | 1 | Grey plaid shirt + Navy Blue/brown. Match Original Blue/brown. Match Original denim trousers + Brown leather boots | Light Blue denim jacket | Light Blue denim jacket | required | - |
| weekday/fall | POLO | 1 | Black cable-knit sweater + Sage pleated trousers + Light blue leather sneakers | - | Olive field jacket | required | JKT-FORM-1 -10 |
| weekday/fall | POLO | 2 | Light pink polo + Ivory pleated trousers + Brown leather tassel loafers | - | Beige zip jacket | required | - |
| weekday/fall | POLO | 3 | Cream long-sleeve polo + Grey pleated trousers + Brown leather sneakers | - | Mint green field jacket | required | - |
| weekday/fall | PURPLE | 1 | Beige knit sweater + Beige trousers + Brown suede tassel loafers | - | Taupe blazer | required | - |
| weekday/fall | PURPLE | 2 | Beige crewneck sweater + Beige trousers + White leather sneakers | - | Blue plaid shearling jacket | required | JKT-COV-3 -5 |
| weekday/fall | ALD | 1 | Black cable-knit sweater + Light blue jeans + Brown leather tassel loafers | - | Brown chore jacket | required | - |
| weekday/fall | ALD | 2 | Pale yellow ribbed polo + Cream straight-leg jeans + Navy suede sneakers | - | Khaki varsity | required | - |
| weekday/fall | ALD | 3 | Grey long-sleeve polo + Sage pleated trousers + Brown suede loafers | - | Navy brown plaid jacket | required | - |
| weekday/fall | FALONI | 1 | Light pink polo + Light Blue striped trousers + Cream leather sneakers | - | Brown suede bomber jacket | required | - |
| weekday/fall | FALONI | 2 | Brown knit polo + Sage pleated trousers + Brown leather boots | - | Beige corduroy blazer | required | - |
| weekday/fall | FALONI | 3 | Cream long-sleeve polo + Light blue jeans + Brown leather sneakers | - | Beige zip jacket | required | - |
| weekday/fall | 545 | 1 | Black bowling shirt + Sage pleated trousers + Navy leather tassel loafers | - | Brown suede jacket | required | - |
| weekday/fall | 545 | 2 | Ivory camp collar shirt + Ivory pleated trousers + Brown suede mules | - | Navy/black corduroy jacket | required | - |
| weekday/fall | SWEETSTABLE | 1 | Pink gingham shirt + Navy Blue/brown. Match Original Blue/brown. Match Original denim trousers + Brown leather tassel loafers | - | Navy brown plaid jacket | required | - |
| weekday/fall | SWEETSTABLE | 2 | Cream fair isle half-zip sweater + Light blue jeans + Brown suede tassel loafers | - | Brown chore jacket | required | - |
| weekday/fall | ITALIANSUMMER | 1 | Blue ivory diamond knit sweater + Light grey pleated trousers + Brown suede loafers | - | Navy field jacket | required | - |
| weekday/fall | ITALIANSUMMER | 2 | Cream fair isle half-zip sweater + Navy corduroy trousers + Brown suede tassel loafers | - | Brown suede jacket | required | - |
| weekday/fall | ITALIANSUMMER | 3 | Grey knit sweater + Sage pleated trousers + Grey and white low-top sneakers | - | Olive field jacket | required | JKT-FORM-1 -10 |
| weekday/fall | ITALIANWINTER | 1 | Blue ivory diamond knit sweater + Light grey pleated trousers + Brown suede loafers | Taupe blazer | Brown shearling bomber jacket | required | JKT-COV-3 -5 |
| weekday/fall | ITALIANWINTER | 2 | Light pink polo + Light Blue striped trousers + Cream leather sneakers | - | Navy/black corduroy jacket | required | - |
| weekday/fall | ITALIANWINTER | 3 | Brown knit polo + Sage pleated trousers + Brown leather boots | - | Taupe blazer | required | - |
| out/fall | RRL | 1 | Black cable-knit sweater + Light blue jeans + Brown leather tassel loafers | - | Brown chore jacket | required | JKT-FORM-1 -5 |
| out/fall | RRL | 2 | Brown knit polo + Sage pleated trousers + Brown leather boots | - | Navy brown plaid jacket | required | - |
| out/fall | RRL | 3 | Olive zip-up knit sweater + Cream straight-leg jeans + Brown suede mules | - | Light blue denim overshirt | required | JKT-FORM-1 -5 |
| out/fall | POLO | 1 | Light pink polo + Ivory pleated trousers + Brown leather tassel loafers | - | Brown suede jacket | required | - |
| out/fall | POLO | 2 | Brown cable-knit sweater + Light blue jeans + Navy leather tassel loafers | - | Khaki varsity | required | JKT-FORM-1 -5 |
| out/fall | POLO | 3 | Light blue long-sleeve polo + Light grey pleated trousers + Brown leather loafers | - | Navy blazer | required | - |
| out/fall | PURPLE | 1 | Beige knit sweater + Beige trousers + Brown suede tassel loafers | - | Navy/black corduroy jacket | required | - |
| out/fall | ALD | 1 | Brown knit polo + Navy Blue/brown. Match Original Blue/brown. Match Original denim trousers + Navy leather tassel loafers | Navy field jacket | Light blue denim jacket | required | JKT-FORM-1 -5 |
| out/fall | ALD | 2 | Light pink polo + Light blue striped jeans + Brown leather tassel loafers | Light Blue denim jacket | Navy brown plaid jacket | required | - |
| out/fall | ALD | 3 | Cream long-sleeve polo + Cream straight-leg jeans + Brown suede loafers | Olive field jacket | Brown chore jacket | required | JKT-FORM-1 -5 |
| out/fall | FALONI | 1 | Navy long-sleeve polo + Beige trousers + Brown suede loafers | - | Brown suede bomber jacket | required | - |
| out/fall | FALONI | 2 | Beige knit sweater + Cream trousers + Brown suede mules | - | Beige zip jacket | required | JKT-FORM-1 -5 |
| out/fall | FALONI | 3 | Beige crewneck sweater + Navy pinstripe trousers + Brown suede tassel loafers | - | Taupe blazer | required | - |
| out/fall | 545 | 1 | Light pink polo + Sage pleated trousers + Brown leather tassel loafers | - | Brown suede jacket | required | - |
| out/fall | 545 | 2 | Brown knit polo + Ivory pleated trousers + Brown leather loafers | - | Ivory double-breasted blazer | required | - |
| out/fall | 545 | 3 | Navy long-sleeve polo + Cream straight-leg jeans + Black woven loafers | - | - (compatible jackets exist but all are capped: Brown suede jacket, Brown suede jacket, Brown suede bomber jacket, Navy/black corduroy jacket) | required | - |
| out/fall | SWEETSTABLE | 1 | Cream fair isle half-zip sweater + Light blue jeans + Brown suede tassel loafers | - | Navy/black corduroy jacket | required | - |
| out/fall | ITALIANSUMMER | 1 | Blue ivory diamond knit sweater + Light grey pleated trousers + Brown suede loafers | - | Navy field jacket | required | JKT-FORM-1 -5 |
| out/fall | ITALIANSUMMER | 2 | Cream fair isle half-zip sweater + Navy corduroy trousers + Brown suede tassel loafers | - | Olive field jacket | required | JKT-FORM-1 -5 |
| out/fall | ITALIANSUMMER | 3 | Olive zip-up knit sweater + Cream straight-leg jeans + Brown suede mules | - | Beige zip jacket | required | JKT-FORM-1 -5 |
| out/fall | ITALIANWINTER | 1 | Blue ivory diamond knit sweater + Light grey pleated trousers + Brown suede loafers | Taupe blazer | Brown shearling bomber jacket | required | JKT-COV-3 -5 |
| out/fall | ITALIANWINTER | 2 | Grey long-sleeve polo + Grey pleated trousers + Brown suede tassel loafers | Brown suede jacket | Navy blazer | required | - |
| out/fall | ITALIANWINTER | 3 | Brown knit polo + Sage pleated trousers + Brown leather boots | - | Beige corduroy blazer | required | - |
| weekend/fall | RRL | 1 | Blue plaid flannel shirt + White distressed jeans + Brown leather boots | Brown chore jacket | Brown chore jacket | preferred | - |
| weekend/fall | POLO | 1 | Black cable-knit sweater + Sage pleated trousers + Light blue leather sneakers | - | Olive field jacket | preferred | - |
| weekend/fall | POLO | 2 | Light pink polo + Ivory pleated trousers + Brown leather tassel loafers | - | Beige corduroy blazer | preferred | - |
| weekend/fall | POLO | 3 | Cream long-sleeve polo + Grey pleated trousers + Brown leather sneakers | - | Mint green field jacket | preferred | - |
| weekend/fall | PURPLE | 1 | Beige knit sweater + Beige trousers + Brown suede tassel loafers | - | Taupe blazer | preferred | - |
| weekend/fall | PURPLE | 2 | Beige trousers + Brown suede loafers | - | Khaki varsity | data-fix | - FLAG: no top (jacket shipped as the top) |
| weekend/fall | PURPLE | 3 | Charcoal button-up + Ivory pleated trousers + Grey distressed sneakers | - | Brown shearling bomber jacket | preferred | JKT-COV-3 -5 |
| weekend/fall | ALD | 1 | Grey knit sweater + White distressed jeans + Brown suede loafers | Navy field jacket | White beige toggle jacket | preferred | - |
| weekend/fall | ALD | 2 | Light Blue denim shirt + Navy Blue/brown. Match Original Blue/brown. Match Original denim trousers + Navy leather tassel loafers | - | Khaki varsity | preferred | - |
| weekend/fall | ALD | 3 | Mauve button-up shirt + Light blue striped jeans + Brown leather tassel loafers | Light Blue denim jacket | Navy brown plaid jacket | preferred | - |
| weekend/fall | FALONI | 1 | Grey knit sweater + Cream trousers + Grey distressed sneakers | - | Brown suede jacket | preferred | - |
| weekend/fall | FALONI | 2 | Black cable-knit sweater + Light grey pleated trousers + Brown leather sneakers | - | - (no jacket beats the missing-jacket penalty) | preferred | JKT-COV-1 -5 |
| weekend/fall | FALONI | 3 | Light blue striped shirt + Ivory pleated trousers + Brown suede mules | - | Beige zip jacket | preferred | - |
| weekend/fall | 545 | 1 | Mauve button-up shirt + Black fleece track pants + White leather sneakers | - | Brown suede jacket | preferred | - |
| weekend/fall | SWEETSTABLE | 1 | Cream fair isle half-zip sweater + White distressed jeans + Brown suede loafers | - | Navy field jacket | preferred | - |
| weekend/fall | SWEETSTABLE | 2 | Pink gingham shirt + Navy Blue/brown. Match Original Blue/brown. Match Original denim trousers + Brown leather tassel loafers | - | Light blue denim jacket | preferred | - |
| weekend/fall | ITALIANSUMMER | 1 | Cream abstract fleece half-zip + Light grey pleated trousers + Brown suede tassel loafers | - | Brown suede jacket | preferred | - |
| weekend/fall | ITALIANSUMMER | 2 | Blue ivory diamond knit sweater + Light grey pleated trousers + Brown suede loafers | - | Navy field jacket | preferred | - |
| weekend/fall | ITALIANSUMMER | 3 | Mauve button-up shirt + Cream pleated trousers + Grey and white low-top sneakers | - | Olive field jacket | preferred | - |
| weekend/fall | ITALIANWINTER | 1 | Blue plaid flannel shirt + Sage pleated trousers + Brown suede loafers | - | Navy blazer | preferred | - |
| weekend/fall | ITALIANWINTER | 2 | Grey plaid shirt + Light Blue trousers + Brown suede tassel loafers | - | Navy/black corduroy jacket | preferred | - |
| weekday/winter | RRL | 1 | Grey plaid shirt + Navy Blue/brown. Match Original Blue/brown. Match Original denim trousers + Brown leather boots | Light Blue denim jacket | Olive field jacket | required | - |
| weekday/winter | POLO | 1 | Black cable-knit sweater + Sage pleated trousers + Light blue leather sneakers | - | Brown chore jacket | required | JKT-FORM-1 -10 |
| weekday/winter | POLO | 2 | Light pink polo + Ivory pleated trousers + Brown leather tassel loafers | - | Navy brown plaid jacket | required | JKT-COV-2 -10 |
| weekday/winter | POLO | 3 | Cream long-sleeve polo + Grey pleated trousers + Brown leather sneakers | - | Khaki varsity | required | JKT-FORM-2 -10 |
| weekday/winter | PURPLE | 1 | Beige knit sweater + Beige trousers + Brown suede tassel loafers | - | Blue plaid shearling jacket | required | - |
| weekday/winter | PURPLE | 2 | Beige crewneck sweater + Beige trousers + White leather sneakers | - | Navy/black corduroy jacket | required | - |
| weekday/winter | ALD | 1 | Black cable-knit sweater + Light blue jeans + Brown leather tassel loafers | - | Brown shearling bomber jacket | required | - |
| weekday/winter | ALD | 2 | Pale yellow ribbed polo + Cream straight-leg jeans + Navy suede sneakers | - | Navy field jacket | required | - |
| weekday/winter | ALD | 3 | Grey long-sleeve polo + Sage pleated trousers + Brown suede loafers | - | Brown chore jacket | required | JKT-COV-2 -10 |
| weekday/winter | FALONI | 1 | Light pink polo + Light Blue striped trousers + Cream leather sneakers | - | Brown shearling bomber jacket | required | - |
| weekday/winter | FALONI | 2 | Brown knit polo + Sage pleated trousers + Brown leather boots | - | Beige corduroy blazer | required | JKT-COV-2 -10 |
| weekday/winter | FALONI | 3 | Cream long-sleeve polo + Light blue jeans + Brown leather sneakers | - | - (compatible jackets exist but all are capped: Brown suede jacket, Brown suede jacket, Brown suede bomber jacket, Brown shearling bomber jacket) | required | - |
| weekday/winter | 545 | 1 | Black bowling shirt + Sage pleated trousers + Navy leather tassel loafers | - | Brown suede bomber jacket | required | JKT-COV-2 -10 |
| weekday/winter | SWEETSTABLE | 1 | Pink gingham shirt + Navy Blue/brown. Match Original Blue/brown. Match Original denim trousers + Brown leather tassel loafers | - | Blue plaid shearling jacket | required | - |
| weekday/winter | SWEETSTABLE | 2 | Cream fair isle half-zip sweater + Light blue jeans + Brown suede tassel loafers | - | Navy field jacket | required | - |
| weekday/winter | ITALIANSUMMER | 1 | Blue ivory diamond knit sweater + Light grey pleated trousers + Brown suede loafers | - | Brown suede jacket | required | - |
| weekday/winter | ITALIANSUMMER | 2 | Cream fair isle half-zip sweater + Navy corduroy trousers + Brown suede tassel loafers | - | Olive field jacket | required | - |
| weekday/winter | ITALIANSUMMER | 3 | Grey knit sweater + Sage pleated trousers + Grey and white low-top sneakers | - | - (compatible jackets exist but all are capped: Brown suede jacket, Navy field jacket, Olive field jacket) | required | JKT-FORM-1 -10 |
| weekday/winter | ITALIANWINTER | 1 | Blue ivory diamond knit sweater + Light grey pleated trousers + Brown suede loafers | Taupe blazer | Brown suede jacket | required | - |
| weekday/winter | ITALIANWINTER | 2 | Light pink polo + Light Blue striped trousers + Cream leather sneakers | - | Navy/black corduroy jacket | required | JKT-COV-2 -10 |
| weekday/winter | ITALIANWINTER | 3 | Brown knit polo + Sage pleated trousers + Brown leather boots | - | Taupe blazer | required | JKT-COV-2 -10 |
| weekend/summer | RRL | 1 | Blue plaid flannel shirt + White distressed jeans + Brown leather boots | Brown chore jacket | Brown chore jacket | optional | - |
| weekend/summer | POLO | 1 | Black cable-knit sweater + Sage pleated trousers + Light blue leather sneakers | - | - | optional | - |
| weekend/summer | POLO | 2 | Light pink polo + Ivory pleated trousers + Brown leather tassel loafers | - | - | optional | - |
| weekend/summer | POLO | 3 | Cream long-sleeve polo + Grey pleated trousers + Brown leather sneakers | - | - | optional | - |
| weekend/summer | PURPLE | 1 | Beige knit sweater + Beige trousers + Brown suede tassel loafers | - | - | optional | - |
| weekend/summer | PURPLE | 2 | Beige trousers + Brown suede loafers | - | Khaki varsity | data-fix | - FLAG: no top (jacket shipped as the top) |
| weekend/summer | PURPLE | 3 | Charcoal button-up + Ivory pleated trousers + Grey distressed sneakers | - | - | optional | - |
| weekend/summer | ALD | 1 | Grey knit sweater + White distressed jeans + Brown suede loafers | Navy field jacket | Navy field jacket | optional | - |
| weekend/summer | ALD | 2 | Light Blue denim shirt + Navy Blue/brown. Match Original Blue/brown. Match Original denim trousers + Navy leather tassel loafers | - | - | optional | - |
| weekend/summer | ALD | 3 | Mauve button-up shirt + Light blue striped jeans + Brown leather tassel loafers | Light Blue denim jacket | - | optional | - |
| weekend/summer | FALONI | 1 | Grey knit sweater + Cream trousers + Grey distressed sneakers | - | - | optional | - |
| weekend/summer | FALONI | 2 | Black cable-knit sweater + Light grey pleated trousers + Brown leather sneakers | - | - | optional | - |
| weekend/summer | FALONI | 3 | Light blue striped shirt + Ivory pleated trousers + Brown suede mules | - | - | optional | - |
| weekend/summer | 545 | 1 | Mauve button-up shirt + Black fleece track pants + White leather sneakers | - | - | optional | - |
| weekend/summer | SWEETSTABLE | 1 | Cream fair isle half-zip sweater + White distressed jeans + Brown suede loafers | - | - | optional | - |
| weekend/summer | SWEETSTABLE | 2 | Pink gingham shirt + Navy Blue/brown. Match Original Blue/brown. Match Original denim trousers + Brown leather tassel loafers | - | - | optional | - |
| weekend/summer | ITALIANSUMMER | 1 | Cream abstract fleece half-zip + Light grey pleated trousers + Brown suede tassel loafers | - | - | optional | - |
| weekend/summer | ITALIANSUMMER | 2 | Blue ivory diamond knit sweater + Light grey pleated trousers + Brown suede loafers | - | - | optional | - |
| weekend/summer | ITALIANSUMMER | 3 | Mauve button-up shirt + Cream pleated trousers + Grey and white low-top sneakers | - | - | optional | - |
| weekend/summer | ITALIANWINTER | 1 | Blue plaid flannel shirt + Sage pleated trousers + Brown suede loafers | - | - | optional | - |
| weekend/summer | ITALIANWINTER | 2 | Grey plaid shirt + Light Blue trousers + Brown suede tassel loafers | - | - | optional | - |

</details>

## 7. Caveats
- Screenshot IDs come from the image, because no capture of these cards exists. Two pairs of plates are identical in the data, so the verdict is the same either way: Light blue jeans `g_rvrs9hibr981` vs `g_fvc535elt23d`, and Light grey pleated `g_k75fdfdsnak0` vs `g_yfkavdj5irwe`. Card 2's shoe is the pink Golden Goose star sneaker, not a white sneaker. I don't know which context the cards came from. Cards 2 and 3 fail COV-1 only on Weekday/Out (fall or winter) or on Weekend/Winter; as Weekend/Fall cards they take -15 and rank below a jacketed version.
- Cut is inferred from names. Four plates (Navy brown plaid, Navy/black cord, Brown suede `g_py2swfwot1ed`, TNF toggle) have no cut data. Plaid and toggle are treated as roomy; the cord and suede jackets are treated as waist length, which is the conservative choice. If the toggle is a hip-length duffle, it becomes Joe's only outer coat.
- "Chunky" includes any relaxed-fit sweater. That makes the relaxed Blue ivory diamond knit illegal under the taupe blazer, so prod IW #1 now fails, and in all three contexts it gets a jacket that goes over a chunky knit instead.
- The weekday/out jacket requirement is hard, as requested. I added an optional weather override for warm fall days (72F or above -> -10). The app would need to pass temperature into the builder for that to work.
- The simulation re-picks jackets only. Most cores still break older rules (COL-9, XC-TEX-3, house bans and so on); those are counted elsewhere and left as they are here. The greedy picker is order-dependent and meant as a plausibility check, not a replacement for the builder.
- JKT-DATA-1 (recategorising the Khaki varsity, renaming the Blue zip-up knit subtype) and the 545/Faloni ban amendments all need Joe's approval. Nothing was written to Supabase or the repo.
- The Brown shearling bomber is outside the T17 brown-suede family on purpose, so it can carry winter. Put it back in the family if Joe wants T17 to cover it.
