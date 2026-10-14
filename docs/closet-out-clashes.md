# Why the out chapter pairs under half the closet

`redress-fill.test.ts` and `rotation.test.ts` ask every chapter to pair at least 45% of its
eligible pieces. The out chapter in fall sits just above that floor on the test closet
(`src/lib/__fixtures__/engine-garments.json`, 157 pieces, 144 eligible in fall). This note
derives, by running the engine, which pieces the chapter refuses and which rule or gate each
one trips, and whether the pattern and colour words restored to the fixture names (the names
are now the stored names without the maker) are what costs them.

## Method

Six Re-dress taps were simulated exactly as the page does them (`weekRotationRow`, then
`rowWays` with the week on screen, `advanceRotation` after each; clock frozen at the
snapshot instant; occasion out, season fall), then the scope's complete `unpairable` list was
read with a zero-card call. For each refused piece, every (top, bottom, shoe) core passing the
cheap gates (`lookFitsOccasion` with the wide weekday-top option, `lookFitsSeason`) was tried
bare and under every in-season jacket through `explain()` in `stylist/legal.ts`, and the
hard hits were tallied. Pieces with no gate-passing core were classified by the gate clause
that refuses them. The same run was made on the fixture as it stood before the names were
restored (the `66bb481` tree's garments, same code). A seeded sample of 2,500 gate-passing
cores times every jacket (50,000 looks) gave the rule frequencies.

| | before the rename | after the rename |
| --- | --- | --- |
| eligible pieces (fall) | 144 | 144 |
| unpairable after six taps | 72 | 74 |
| pairable share | 0.500 | 0.486 |

## Finding

The floor is set by the out gate in `lookFitsOccasion` (`src/lib/lookbook.ts`), not by the
pattern rules. Of the 74 refused pieces, 61 never pass the gate; the other 13 are refused by
the jacket layering rules. Restoring the names changed three verdicts and only one of them
through a restored word:

- `g_zw51yaqdsx0q` white distressed jeans: the restored word "distressed" trips the gate
  clause that keeps distressed jeans to weekend and comfy. Pairable before, refused now.
- `g_8od90wk1sl9k` brown suede bomber jacket and `g_py2swfwot1ed` brown suede jacket: names
  unchanged. Refused now, pairable before; the search order shifted and the budget ran out
  (see the jackets note below).
- `g_x4adkv9zu9yu` navy/black corduroy jacket: name unchanged. Pairable now, refused before,
  for the same reason.

Every other piece whose name gained a pattern word was already refused before the rename, by
the same clause. The pattern rule XC-PAT-1 (`stylist/rules.ts`) fires as a hard hit in 0.3%
of sampled out looks after the rename (151 of 50,000; none before) and costs no piece its
pairability.

## Refused pieces whose restored words are pattern words

All refused by the gate before the rename too, except the white distressed jeans.

| id | fixture name | restored words | what refuses it |
| --- | --- | --- | --- |
| `g_zw51yaqdsx0q` | white distressed jeans | distressed | out gate: distressed jeans are weekend and comfy only (newly refused) |
| `g_e4y3rjpn57gj` | black white check shirt | white check | out gate: top is not an oxford, polo, camp collar or knit |
| `g_2b6fao81vqrs` | blue plaid flannel shirt | plaid | out gate: top kind |
| `g_21b6d3qcohmu` | brown blue plaid shirt (button-down) | blue plaid | out gate: top kind |
| `g_z6syv3lx30tn` | brown blue plaid shirt (regular collar) | blue plaid | out gate: top kind |
| `g_o739106dt8ym` | cream abstract fleece half-zip | abstract half-zip | out gate: top kind |
| `g_1gb6slz8h71n` | cream embroidered shirt | embroidered shirt | out gate: top kind |
| `g_k0mfejxiu5f8` | cream printed fleece pullover | printed | out gate: top kind |
| `g_zc85ll18q9kn` | cream printed shirt | printed | out gate: top kind |
| `g_ef0u3ljnwa09` | grey herringbone puffer vest | herringbone puffer | out gate: top kind |
| `g_teatot7o1lst` | grey plaid shirt | plaid | out gate: top kind |
| `g_j4qu90fgv347` | light blue plaid flannel | plaid | out gate: top kind |
| `g_kh5r3xy9r1i5` | light blue striped shirt | striped | out gate: top kind |
| `g_zzrq3j5n2njk` | pink gingham shirt | gingham | out gate: top kind |
| `g_qn51qgub6tu3` | red gingham shirt | red gingham | out gate: top kind |
| `g_i80zb0yen5gn` | sage striped shirt | sage striped | out gate: top kind |
| `g_upplq59rp8lp` | white logo t-shirt | logo | out gate: top kind |
| `g_sxxi5soxomf3` | black 90s hoodie | 90s | out gate: hoodie or sweatshirt (`isHoodiePiece`) |
| `g_6uhygeskozw8` | black color-block hoodie | color-block | out gate: hoodie or sweatshirt |
| `g_mpvyy87tse1c` | cream flag sweatshirt | flag | out gate: hoodie or sweatshirt |
| `g_b8n14erlispm` | grey distressed sneakers | distressed | out gate: sneaker while a loafer, mule or boot is owned |
| `g_rxglifsoqobm` | pink suede star sneakers | star | out gate: sneaker while a loafer, mule or boot is owned |
| `g_491tzu2suiv7` | blue plaid shearling jacket | plaid shearling | JKT-LAY-5 in 72% of its looks; XC-PAT-1 only where the top is also patterned |

## The rest of the refused pieces, by clause

- **Top is not an oxford, polo, camp collar or knit (17 more):** `g_i2191l774tad` brown
  long-sleeve shirt, `g_q3e47jxb10wb` charcoal button-up, `g_u0f8e90jp3ez` cream button-up
  shirt, `g_ap5v0s67pg9d` dark brown button-up shirt, `g_6lolc7ma0mk8` dark grey button-down
  shirt, `g_7z48xpoqh5tx` grey shirt, `g_j5og5jmzh5tx` khaki varsity, `g_v7uvadckh79p` light
  blue denim overshirt, `g_1zteshjh31ac` and `g_yo7mwga1xi3m` light blue denim shirt,
  `g_2rtuat7aheik` light blue dress shirt, `g_8m17f0l0tss9` light blue half-zip fleece,
  `g_m7bg5j5z10wc` light blue henley, `g_mir3akjyhwnr` light blue t-shirt, `g_tqnnde1xmp0p`
  mauve button-up shirt, `g_mq1ob9uc1npn` rust button-down, `g_pa7kfg14rtzl` white button-up
  shirt.
- **Hoodie or sweatshirt (11 more):** `g_hslm9n4nmc79` beige mock-neck sweatshirt,
  `g_dsqnx6ckt81v` and `g_kp1ps7qww1ar` beige quarter-zip sweatshirt, `g_7iyagp6doqqz` and
  `g_h7dy95xdgnh8` black hoodie, `g_u1ujhidqsibg` and `g_z7nhuz8vidky` cream hoodie,
  `g_6qz38nwsrupx` cream sweatshirt, `g_j1n1vh1wvbo4` grey half-zip fleece,
  `g_1khiworawkt7` light blue quarter-zip sweatshirt.
- **Sneaker while a loafer, mule or boot is owned (9 more):** `g_wgarjdurj7yp` brown leather
  sneakers, `g_upni66uiqtgb` cream leather sneakers, `g_08shegj8gqie` grey and white low-top
  sneakers, `g_kde45hmnqie9` light blue leather sneakers, `g_fzekzikyrf50` navy suede
  sneakers, `g_01xaga54r12h`, `g_2wf48xbqlgcv`, `g_9q0j6ksxlgcv`, `g_nq7il0e0glnn` white
  leather sneakers.
- **Bottom is not a trouser, chino, jean or cord (3):** `g_mjno2x20podx` black fleece track
  pants, `g_lg5qftegw0qo` brown frayed-hem pants, `g_nffskb5hta4l` cream ribbed pants.
- **Knit tops the gate admits but no look holds (3):** `g_xc4gr022xmvm` cream cable-knit
  cardigan (style clashes 38%, JKT-LAY-5 35%, JKT-LAY-1 20%), `g_j2id379jo424` blue zip-up
  knit jacket and `g_hhbz4ghpjmd1` navy ribbed zip sweater (style clashes in 85% of looks,
  then JKT-COV-1 bare and JKT-LAY-3 under a sport coat).
- **Jackets (9 more):** `g_whgv0gu6m08l` beige corduroy blazer, `g_98p2sivflrxg` ivory
  double-breasted blazer, `g_5josnvyoi4z9` navy blazer, `g_juk45cokjxxy` taupe blazer
  (JKT-LAY-1 72%, JKT-LAY-3 21%); `g_ulv8tgkujvjh` and `g_vtbi91noucd3` light blue denim
  jacket (JKT-LAY-5 72%, XC-DEN-1 19%); `g_ed0ga2v0q2yo` beige zip jacket, `g_8od90wk1sl9k`
  brown suede bomber jacket, `g_py2swfwot1ed` brown suede jacket (JKT-LAY-5 72%).

Jackets note: for every one of the ten refused jackets the probe found legal looks (58 to 82
of the first 300 gate-passing cores). The engine lists them because `pairableIn` searches the
cores in id order with a fixed try budget (`PAIR_TRIES`), and the layering rules refuse about
three cores in four before a legal one is reached. That is a budget effect, not a pattern
effect, and it is why two brown suede jackets and the corduroy jacket swapped verdicts with no
change to their names.

## Rules named here

- **Out gate** (`lookFitsOccasion`, `src/lib/lookbook.ts`): a top must be an oxford, polo,
  camp collar or knit and not a hoodie or sweatshirt; a bottom must be a trouser, chino, jean
  or cord, and distressed jeans are weekend and comfy only; a sneaker is refused while the
  closet owns a loafer, mule or boot.
- **JKT-LAY-1** (`stylist/jackets.ts`): a chunky or athletic top under a sport coat.
- **JKT-LAY-3**: a track, lounge, distressed, white, striped, light-wash or mid-wash bottom
  with a sport coat.
- **JKT-LAY-5**: a close or light jacket over a chunky knit.
- **JKT-COV-1**: out in fall needs a jacket or coat.
- **XC-PAT-1** (`stylist/rules.ts`): two same-scale stripes, two large checks or busy prints,
  or a busy print with a check. After the rename it fires on `g_vzqle7zdtpis` blue ivory
  diamond knit sweater, `g_3qjmw7n4wj2a` navy brown plaid jacket, `g_491tzu2suiv7` blue plaid
  shearling jacket, `g_btael28aebgu` beige patchwork jeans and `g_twp15jpdf6h3` blue pinstripe
  trousers; all but the shearling jacket stay pairable.
- **XC-DEN-1**, **XC-PROP-1** (`stylist/rules.ts`): the denim and proportion rules, minor
  shares here.
