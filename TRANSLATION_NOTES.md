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
| `fr` | `all_time_score_summary` | Same telegraphic mis-parse. | `meilleur score 💯 {score} · {games} parties` | claude-corrected, unverified |
| `es` | `signed_in_as` | **First person**: `He iniciado sesión como {name}` = "*I* have signed in as…". | `Sesión iniciada como {name}` | claude-corrected, unverified |
| `es` | `stat_games_played` | `Partidos disputados` = sports fixtures. | `Partidas jugadas` | claude-corrected, unverified |
| `es` | `stat_last_played` | `Último partido disputado` = sports fixture. | `Última partida` | claude-corrected, unverified |
| `es` | `play_again_button` | `Volver a reproducir` = replay a *video*. | `Volver a jugar` | claude-corrected, unverified |
| `es` | `all_time_score_summary` | Same telegraphic mis-parse. | `mejor puntuación 💯 {score} · {games} partidas` | claude-corrected, unverified |
| `pt-br` | `signed_in_as` | `Entrou com o nome de usuário {name}` — verbose; overflows the header. | `Conectado como {name}` | claude-corrected, unverified |
| `pt-br` | `next_round_in` | `no {seconds}` — wrong preposition for a duration. | `Próxima rodada em {seconds}…` | claude-corrected, unverified |
| `pt-br` | `all_time_score_summary` | Same telegraphic mis-parse. | `melhor pontuação 💯 {score} · {games} partidas` | claude-corrected, unverified |
| `pt-pt` | `username_required_error` | Formal (`Introduza`). | `Introduz primeiro um nome de utilizador.` | claude-corrected, unverified |
| `pt-pt` | `connection_error` | Formal (`por favor, tente`). | `Erro de ligação — tenta novamente.` | claude-corrected, unverified |
| `pt-pt` | `sign_in_prompt` | Formal (`Inicie… as suas`). | `🔐 Inicia sessão para veres as tuas estatísticas` | claude-corrected, unverified |
| `pt-pt` | `round_progress` | **Word dropped**: bare `{round}/{total}` with no `Ronda`. | `Ronda {round}/{total}` | claude-corrected, unverified |
| `pt-pt` | `next_round_in` | Aligned with the `Ronda` wording used elsewhere. | `Próxima ronda em {seconds}…` | claude-corrected, unverified |
| `pt-pt` | `persistent_hint` | `até à 🚩` disagreed with `até ao 🚩` in the sibling string; also formal. | `Teclas de setas para te moveres. Corre até ao 🚩!` | claude-corrected, unverified |
| `pt-pt` | `all_time_score_summary` | Same telegraphic mis-parse. | `melhor pontuação 💯 {score} · {games} partidas` | claude-corrected, unverified |
| `ru` | `app_tagline` | Formal (`Съедайте`). | `Съедай все смайлики, соответствующие ключевому слову. Остальные стоят одну жизнь.` | claude-corrected, unverified |
| `ru` | `connection_error` | Formal (`попробуйте`). | `Ошибка подключения — попробуй ещё раз.` | claude-corrected, unverified |
| `ru` | `sign_in_prompt` | **Not a word**: `листую статистику`. Garbled from `личную` (personal). | `🔐 Войди, чтобы посмотреть свою статистику` | claude-corrected, unverified |
| `ru` | `stat_games_played` | `Проведенные матчи` = sports fixtures. | `Сыграно игр` | claude-corrected, unverified |
| `ru` | `stat_last_played` | `Последний матч` = sports fixture. | `Последняя игра` | claude-corrected, unverified |
| `ru` | `round_one_banner` | Formal (`Съедайте… вам`). | `Съедай смайлики, соответствующие ключевому слову — остальные стоят жизни. Мчись к 🚩!` | claude-corrected, unverified |
| `ru` | `persistent_hint` | Lost its preposition after quote removal: `в гонке 🚩`. | `Стрелки — для перемещения. Мчись к 🚩!` | claude-corrected, unverified |
| `ru` | `all_time_score_summary` | Same telegraphic mis-parse. | `лучший счёт 💯 {score} · игр: {games}` | claude-corrected, unverified |
| `pt-pt` | `signed_in_as` | Formal and verbose (`Iniciou sessão com o nome de utilizador {name}`); overflows the header. | `Sessão iniciada como {name}` | claude-corrected, unverified |
| `ru` | `signed_in_as` | `Вошел` missing its ё (`Вошёл`), and phrasing inconsistent with the other locales. | `Вошёл как {name}` | claude-corrected, unverified |

## Known-remaining issue

`all_time_score_summary` is broken in **English**, not just in translation:
`best {score} · {games} games` is telegraphic enough that DeepL parsed *best*
as an adjective of *games* in all five languages. The overrides above patch
each language, but the English source is the actual defect and a reworded
English string is pending review. When it lands, revisit these five rows —
an override silently keeps winning even after its English is fixed.
