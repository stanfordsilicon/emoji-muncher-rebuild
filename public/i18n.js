// i18n runtime for Emoji Munchers.
//
// English-only for now -- there's no language switcher in this game yet.
// I18N_STRINGS.en is the single source of truth for every piece of UI
// text; more languages get added as new blocks here (I18N_STRINGS.es,
// etc.) once translations come back. The clean key -> English export
// handed off for translation lives at ../i18n-source/en.json (repo root,
// outside public/, so it's never part of what actually gets deployed) --
// keep that file's keys in sync with this one.
//
// t(key, vars) looks up a string and fills in any {placeholder} tokens
// (e.g. t('round_progress', { round: 2, total: 8 })). Falls back to the
// raw key if it's ever missing, so a typo shows up as visibly broken text
// instead of silently rendering nothing.
const I18N_LANG = "en";

const I18N_STRINGS = {
  en: {
    app_title: "😋 Emoji Munchers",
    app_tagline: "Munch every emoji that matches the keyword. The rest cost a life.",
    back_to_launchpad: "RETURN TO LAUNCH PAD",
    loading: "LOADING",
    username_label: "Username",
    username_placeholder: "e.g. sid",
    play_button: "Play",
    username_required_error: "Enter a username first.",
    connection_error: "Connection error — please try again.",
    sign_in_prompt: "🔐 Sign in for personal stats",
    auth_username_placeholder: "Username",
    auth_password_placeholder: "Password",
    sign_in_button: "Sign In",
    sign_up_button: "Sign Up",
    my_stats_button: "📊 My Stats",
    sign_out_button: "Sign out",
    signed_in_as: "Signed in as {name}",
    my_stats_title: "📊 My Stats",
    stat_games_played: "Games played",
    stat_best_score: "Best score",
    stat_total_score: "Total score",
    stat_last_played: "Last played",
    stat_never: "—",
    close_button: "Close",
    round_progress: "Round {round}/{total}",
    round_one_banner: "Eat emojis that match the keyword — the rest cost a life. Race to the 🚩!",
    next_round_in: "Next round in {seconds}…",
    next_round_now: "Next round…",
    persistent_hint: "Arrow keys to move. Race to the 🚩!",
    game_over_title: "Game Over",
    final_score: "💯 Final score: {score}",
    all_time_leaderboard_heading: "All-time leaderboard",
    play_again_button: "Play Again",
    home_button: "🏠 Home",
    all_time_score_summary: "best 💯 {score} · {games} games",
  },
};

function t(key, vars) {
  const table = I18N_STRINGS[I18N_LANG] || I18N_STRINGS.en;
  let text = (table && table[key]) || I18N_STRINGS.en[key] || key;
  if (vars) {
    Object.keys(vars).forEach((k) => {
      text = text.split(`{${k}}`).join(vars[k]);
    });
  }
  return text;
}

// Applies every static (non-templated) string in one pass on load --
// anything with dynamic content (a score, a room code, a countdown) is set
// directly by client.js via t() instead, since data-i18n has no way to
// carry variables.
function applyStaticTranslations() {
  document.querySelectorAll("[data-i18n]").forEach((el) => {
    el.textContent = t(el.getAttribute("data-i18n"));
  });
  document.querySelectorAll("[data-i18n-placeholder]").forEach((el) => {
    el.setAttribute("placeholder", t(el.getAttribute("data-i18n-placeholder")));
  });
}
