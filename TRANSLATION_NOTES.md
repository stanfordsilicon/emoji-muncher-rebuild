# Translation notes — Emoji Munchers

Provenance for every hand-overridden string in `public/locales/*.overrides.json`.

**Nothing in this table has been checked by a native speaker.** Every row was
written by Claude from inspection of the DeepL output. The `Status` column is
the record of that: it says `claude-corrected, unverified` and must only be
changed to `human-verified` by a person who actually speaks the language.

Strings *not* listed here are raw DeepL output — also unverified, but not
known to be wrong. Corrections belong in the `.overrides.json` file, never in
the generated `<lang>.json`.

Total overridden: **36** strings across 5 languages.

| Lang | Key | What was wrong | Replacement | Status |
|---|---|---|---|---|
| `fr` | `connection_error` | Formal (`veuillez réessayer`). | `Erreur de connexion — réessaie.` | claude-corrected, unverified |
| `fr` | `sign_in_prompt` | Formal (`Connectez-vous… vos`). | `🔐 Connecte-toi pour voir tes statistiques` | claude-corrected, unverified |
| `fr` | `signed_in_as` | **Breaks on real data**: `Connecté sous le nom d'{name}` elides to `d'Bob` for consonant-initial names. | `Connecté en tant que {name}` | claude-corrected, unverified |
| `fr` | `stat_games_played` | `Matchs disputés` = sports fixtures, not arcade games. | `Parties jouées` | claude-corrected, unverified |
| `fr` | `stat_total_score` | `Note de score` is not French. (Pre-glossary it was `Note totale` = a school grade.) | `Score total` | claude-corrected, unverified |
| `fr` | `stat_last_played` | `Dernière partie jouée` — redundant, and overflows. | `Dernière partie` | claude-corrected, unverified |
| `fr` | `round_progress` | DeepL left the English word `Round` untranslated. | `Tour {round}/{total}` | claude-corrected, unverified |
| `fr` | `round_one_banner` | Formal (`Mangez… vous coûtent`). | `Mange les emojis qui correspondent au mot-clé — les autres te coûtent une vie. Fonce vers le 🚩 !` | claude-corrected, unverified |
| `fr` | `next_round_in` | **Wrong meaning**: `Prochain tour d'{seconds}…` = "next round *of* 5s", not "in 5s". | `Prochain tour dans {seconds}…` | claude-corrected, unverified |
| `fr` | `persistent_hint` | Formal (`Utilisez… vous déplacer`), and long enough to wrap on mobile. | `Flèches pour te déplacer. Fonce vers le 🚩 !` | claude-corrected, unverified |
| `fr` | `all_time_score_summary` | Same telegraphic mis-parse. | `meilleur score 🏆 {score} · {games} parties` | claude-corrected, unverified |
| `es` | `signed_in_as` | **First person**: `He iniciado sesión como {name}` = "*I* have signed in as…". | `Sesión iniciada como {name}` | claude-corrected, unverified |
| `es` | `stat_games_played` | `Partidos disputados` = sports fixtures. | `Partidas jugadas` | claude-corrected, unverified |
| `es` | `stat_last_played` | `Último partido disputado` = sports fixture. | `Última partida` | claude-corrected, unverified |
| `es` | `play_again_button` | `Volver a reproducir` = replay a *video*. | `Volver a jugar` | claude-corrected, unverified |
| `es` | `all_time_score_summary` | Same telegraphic mis-parse. | `mejor puntuación 🏆 {score} · {games} partidas` | claude-corrected, unverified |
| `pt-br` | `signed_in_as` | `Entrou com o nome de usuário {name}` — verbose; overflows the header. | `Conectado como {name}` | claude-corrected, unverified |
| `pt-br` | `next_round_in` | `no {seconds}` — wrong preposition for a duration. | `Próxima rodada em {seconds}…` | claude-corrected, unverified |
| `pt-br` | `all_time_score_summary` | Same telegraphic mis-parse. | `melhor pontuação 🏆 {score} · {games} partidas` | claude-corrected, unverified |
| `pt-pt` | `username_required_error` | Formal (`Introduza`). | `Introduz primeiro um nome de utilizador.` | claude-corrected, unverified |
| `pt-pt` | `connection_error` | Formal (`por favor, tente`). | `Erro de ligação — tenta novamente.` | claude-corrected, unverified |
| `pt-pt` | `sign_in_prompt` | Formal (`Inicie… as suas`). | `🔐 Inicia sessão para veres as tuas estatísticas` | claude-corrected, unverified |
| `pt-pt` | `round_progress` | **Word dropped**: bare `{round}/{total}` with no `Ronda`. | `Ronda {round}/{total}` | claude-corrected, unverified |
| `pt-pt` | `next_round_in` | Aligned with the `Ronda` wording used elsewhere. | `Próxima ronda em {seconds}…` | claude-corrected, unverified |
| `pt-pt` | `persistent_hint` | `até à 🚩` disagreed with `até ao 🚩` in the sibling string; also formal. | `Teclas de setas para te moveres. Corre até ao 🚩!` | claude-corrected, unverified |
| `pt-pt` | `all_time_score_summary` | Same telegraphic mis-parse. | `melhor pontuação 🏆 {score} · {games} partidas` | claude-corrected, unverified |
| `ru` | `app_tagline` | Formal (`Съедайте`). | `Съедай все смайлики, соответствующие ключевому слову. Остальные стоят одну жизнь.` | claude-corrected, unverified |
| `ru` | `connection_error` | Formal (`попробуйте`). | `Ошибка подключения — попробуй ещё раз.` | claude-corrected, unverified |
| `ru` | `sign_in_prompt` | **Not a word**: `листую статистику`. Garbled from `личную` (personal). | `🔐 Войди, чтобы посмотреть свою статистику` | claude-corrected, unverified |
| `ru` | `stat_games_played` | `Проведенные матчи` = sports fixtures. | `Сыграно игр` | claude-corrected, unverified |
| `ru` | `stat_last_played` | `Последний матч` = sports fixture. | `Последняя игра` | claude-corrected, unverified |
| `ru` | `round_one_banner` | Formal (`Съедайте… вам`). | `Съедай смайлики, соответствующие ключевому слову — остальные стоят жизни. Мчись к 🚩!` | claude-corrected, unverified |
| `ru` | `persistent_hint` | Lost its preposition after quote removal: `в гонке 🚩`. | `Стрелки — для перемещения. Мчись к 🚩!` | claude-corrected, unverified |
| `ru` | `all_time_score_summary` | Same telegraphic mis-parse. | `лучший счёт 🏆 {score} · игр: {games}` | claude-corrected, unverified |
| `pt-pt` | `signed_in_as` | Formal and verbose (`Iniciou sessão com o nome de utilizador {name}`); overflows the header. | `Sessão iniciada como {name}` | claude-corrected, unverified |
| `ru` | `signed_in_as` | `Вошел` missing its ё (`Вошёл`), and phrasing inconsistent with the other locales. | `Вошёл как {name}` | claude-corrected, unverified |

## Known-remaining issue

`all_time_score_summary` is broken in **English**, not just in translation:
`best {score} · {games} games` is telegraphic enough that DeepL parsed *best*
as an adjective of *games* in all five languages. The overrides above patch
each language, but the English source is the actual defect and a reworded
English string is pending review. When it lands, revisit these five rows —
an override silently keeps winning even after its English is fixed.

## Adopted from Sid's translations

Sid (@HtchHiker42) hand-translated these games independently. His strings were
superseded by the pipeline, but not before diffing them key by key against mine.
Where his read better, his is used — credited here rather than relabelled as my
own work. **These are Sid's words and are still unverified by a native speaker.**

He caught four things I had genuinely got wrong or missed: a French
`make_host_button` I fixed in two other languages but not French, a formal
`Réessayez` and `Commencez` that slipped past my own register pass, a Russian
`в {seconds}` that means *at 5* rather than *in 5 seconds*, and the pt-br
sports-fixture register I fixed everywhere except pt-br.

His systematic weaknesses, which is why the rest was not adopted: Title Case
applied to Spanish, French, Portuguese and Russian (none of which use it),
formal register throughout Russian, and translating the game's own name.

Adopted here: **20** strings from Sid, plus
**1** of my own that this comparison exposed.

| Lang | Key | Why | Value | Source |
|---|---|---|---|---|
| `es` | `back_to_launchpad` | Sid's is far shorter and reads as arcade language. Mine (`VOLVER A LA PLATAFORMA DE LANZAMIENTO`) was the string I measured overflowing its button at 375px by up to 85%, so this fixes a real layout bug as well. | `VOLVER A LA BASE` | **from Sid** (his translation, unverified) |
| `es` | `game_over_title` | Sid's `Fin del Juego` reads as a heading where mine (`Se acabó el juego`) is a sentence; adopted the phrasing in sentence case. | `Fin del juego` | claude-corrected, unverified |
| `es` | `persistent_hint` | Same feminine agreement for the flag, and shorter. | `Usa las flechas para moverte. ¡Corre hacia la 🚩!` | **from Sid** (his translation, unverified) |
| `es` | `round_one_banner` | Sid agrees the article with *bandera*/*bandeira* (feminine): `la 🚩` / `a 🚩`. Mine used the masculine. | `Come los emojis que coincidan con la palabra clave — los demás te cuestan una vida. ¡Corre hacia la 🚩!` | **from Sid** (his translation, unverified) |
| `es` | `username_placeholder` | Shorter, which suits a placeholder. | `ej. sid` | **from Sid** (his translation, unverified) |
| `fr` | `back_to_launchpad` | Sid's is far shorter and reads as arcade language. Mine (`VOLVER A LA PLATAFORMA DE LANZAMIENTO`) was the string I measured overflowing its button at 375px by up to 85%, so this fixes a real layout bug as well. | `RETOUR À LA BASE` | **from Sid** (his translation, unverified) |
| `fr` | `loading` | `CHARGEMENT` matches the English's length; mine (`CHARGEMENT EN COURS`) was 172% longer and at risk of overflow. | `CHARGEMENT` | **from Sid** (his translation, unverified) |
| `fr` | `username_placeholder` | Shorter, which suits a placeholder. | `ex. sid` | **from Sid** (his translation, unverified) |
| `fr` | `username_required_error` | **Mine was formal** (`Commencez par saisir`). Sid's is informal. | `Entre d'abord un nom d'utilisateur.` | **from Sid** (his translation, unverified) |
| `pt-br` | `back_to_launchpad` | Sid's is far shorter and reads as arcade language. Mine (`VOLVER A LA PLATAFORMA DE LANZAMIENTO`) was the string I measured overflowing its button at 375px by up to 85%, so this fixes a real layout bug as well. | `VOLTAR À BASE` | **from Sid** (his translation, unverified) |
| `pt-br` | `persistent_hint` | Same feminine agreement for the flag, and shorter. | `Use as setas para se mover. Corra até a 🚩!` | **from Sid** (his translation, unverified) |
| `pt-br` | `round_one_banner` | Sid agrees the article with *bandera*/*bandeira* (feminine): `la 🚩` / `a 🚩`. Mine used the masculine. | `Coma os emojis que combinam com a palavra-chave — os demais custam uma vida. Corra até a 🚩!` | **from Sid** (his translation, unverified) |
| `pt-br` | `stat_games_played` | **I missed pt-br.** I fixed the sports-fixture register (`Jogos disputados`) in fr/es/ru but not here. | `Partidas jogadas` | **from Sid** (his translation, unverified) |
| `pt-br` | `stat_last_played` | Same miss — `Último jogo disputado` is sports-fixture register. | `Última partida` | **from Sid** (his translation, unverified) |
| `pt-br` | `username_placeholder` | Shorter, which suits a placeholder. | `ex. sid` | **from Sid** (his translation, unverified) |
| `pt-pt` | `back_to_launchpad` | Sid's is far shorter and reads as arcade language. Mine (`VOLVER A LA PLATAFORMA DE LANZAMIENTO`) was the string I measured overflowing its button at 375px by up to 85%, so this fixes a real layout bug as well. | `VOLTAR À BASE` | **from Sid** (his translation, unverified) |
| `pt-pt` | `username_placeholder` | Shorter, which suits a placeholder. | `ex. sid` | **from Sid** (his translation, unverified) |
| `ru` | `all_time_leaderboard_heading` | `Таблица рекордов` is idiomatic and much shorter than mine. | `Таблица рекордов` | **from Sid** (his translation, unverified) |
| `ru` | `back_to_launchpad` | Sid's is far shorter and reads as arcade language. Mine (`VOLVER A LA PLATAFORMA DE LANZAMIENTO`) was the string I measured overflowing its button at 375px by up to 85%, so this fixes a real layout bug as well. | `ВЕРНУТЬСЯ НА БАЗУ` | **from Sid** (his translation, unverified) |
| `ru` | `next_round_in` | **Mine was wrong.** `в {seconds}` means *at* 5, not *in* 5 seconds. `через` is correct. | `Следующий раунд через {seconds}…` | **from Sid** (his translation, unverified) |
| `ru` | `username_placeholder` | Shorter, which suits a placeholder. | `напр. sid` | **from Sid** (his translation, unverified) |
