// i18n runtime for Emoji Munchers.
//
// Covers the 5 UI languages QMoji 2.0's homescreen lets a player pick
// (en/es/fr/pt/ru -- see qmoji-2's QMOJI_UI_LANGUAGES). I18N_STRINGS.en is
// the single source of truth for every key that exists; the other blocks
// mirror its keys 1:1. The clean key -> language exports handed off for
// translation live at ../i18n-source/{lang}.json (repo root, outside
// public/, so they're never part of what actually gets deployed) -- keep
// those files' keys in sync with this one.
//
// t(key, vars) looks up a string and fills in any {placeholder} tokens
// (e.g. t('round_progress', { round: 2, total: 8 })). Falls back to the
// raw key if it's ever missing, so a typo shows up as visibly broken text
// instead of silently rendering nothing.
//
// Resolved per-call (not a fixed top-level const) so it reflects whatever
// interface language the QMoji 2.0 homescreen actually launched this game
// with (?uiLang=), read directly from the URL rather than waiting on
// arcade-client.js's async initArcade() -- checking the URL synchronously
// here means the very first render already picks the right language
// instead of only catching up on a later visit once initArcade() has had a
// chance to persist it to localStorage.
function resolveI18nLang() {
  try {
    const fromUrl = new URLSearchParams(location.search).get("uiLang");
    if (fromUrl && I18N_STRINGS[fromUrl]) return fromUrl;
    const fromStorage = localStorage.getItem("qmoji.uiLang");
    if (fromStorage && I18N_STRINGS[fromStorage]) return fromStorage;
  } catch (e) {
    /* localStorage/URL access can throw in some embedded contexts -- fall through to "en" */
  }
  return "en";
}

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
    final_score: "🏆 Final score: {score}",
    all_time_leaderboard_heading: "All-time leaderboard",
    play_again_button: "Play Again",
    home_button: "🏠 Home",
    all_time_score_summary: "best 🏆 {score} · {games} games",
  },
  es: {
    app_title: "😋 Devoradores de Emojis",
    app_tagline: "Devora todos los emojis que coincidan con la palabra clave. Los demás te cuestan una vida.",
    back_to_launchpad: "VOLVER A LA BASE",
    loading: "CARGANDO",
    username_label: "Nombre de usuario",
    username_placeholder: "ej. sid",
    play_button: "Jugar",
    username_required_error: "Ingresa un nombre de usuario primero.",
    connection_error: "Error de conexión — inténtalo de nuevo.",
    sign_in_prompt: "🔐 Inicia sesión para ver tus estadísticas",
    auth_username_placeholder: "Nombre de usuario",
    auth_password_placeholder: "Contraseña",
    sign_in_button: "Iniciar Sesión",
    sign_up_button: "Registrarse",
    my_stats_button: "📊 Mis Estadísticas",
    sign_out_button: "Cerrar sesión",
    signed_in_as: "Sesión iniciada como {name}",
    my_stats_title: "📊 Mis Estadísticas",
    stat_games_played: "Partidas jugadas",
    stat_best_score: "Mejor puntuación",
    stat_total_score: "Puntuación total",
    stat_last_played: "Última partida",
    stat_never: "—",
    close_button: "Cerrar",
    round_progress: "Ronda {round}/{total}",
    round_one_banner: "Come los emojis que coincidan con la palabra clave — los demás te cuestan una vida. ¡Corre hacia la 🚩!",
    next_round_in: "Siguiente ronda en {seconds}…",
    next_round_now: "Siguiente ronda…",
    persistent_hint: "Usa las flechas para moverte. ¡Corre hacia la 🚩!",
    game_over_title: "Fin del Juego",
    final_score: "🏆 Puntuación final: {score}",
    all_time_leaderboard_heading: "Clasificación histórica",
    play_again_button: "Jugar de Nuevo",
    home_button: "🏠 Inicio",
    all_time_score_summary: "mejor 🏆 {score} · {games} partidas",
  },
  fr: {
    app_title: "😋 Croqueurs d'Emojis",
    app_tagline: "Croque tous les emojis qui correspondent au mot-clé. Les autres te coûtent une vie.",
    back_to_launchpad: "RETOUR À LA BASE",
    loading: "CHARGEMENT",
    username_label: "Nom d'utilisateur",
    username_placeholder: "ex. sid",
    play_button: "Jouer",
    username_required_error: "Entre d'abord un nom d'utilisateur.",
    connection_error: "Erreur de connexion — réessaie.",
    sign_in_prompt: "🔐 Connecte-toi pour voir tes statistiques",
    auth_username_placeholder: "Nom d'utilisateur",
    auth_password_placeholder: "Mot de passe",
    sign_in_button: "Se Connecter",
    sign_up_button: "S'inscrire",
    my_stats_button: "📊 Mes Statistiques",
    sign_out_button: "Se déconnecter",
    signed_in_as: "Connecté en tant que {name}",
    my_stats_title: "📊 Mes Statistiques",
    stat_games_played: "Parties jouées",
    stat_best_score: "Meilleur score",
    stat_total_score: "Score total",
    stat_last_played: "Dernière partie",
    stat_never: "—",
    close_button: "Fermer",
    round_progress: "Manche {round}/{total}",
    round_one_banner: "Mange les emojis qui correspondent au mot-clé — les autres te coûtent une vie. Fonce vers le 🚩 !",
    next_round_in: "Prochaine manche dans {seconds}…",
    next_round_now: "Prochaine manche…",
    persistent_hint: "Utilise les flèches pour te déplacer. Fonce vers le 🚩 !",
    game_over_title: "Partie Terminée",
    final_score: "🏆 Score final : {score}",
    all_time_leaderboard_heading: "Classement général",
    play_again_button: "Rejouer",
    home_button: "🏠 Accueil",
    all_time_score_summary: "meilleur 🏆 {score} · {games} parties",
  },
  pt: {
    app_title: "😋 Devoradores de Emojis",
    app_tagline: "Devore todos os emojis que combinam com a palavra-chave. Os demais custam uma vida.",
    back_to_launchpad: "VOLTAR À BASE",
    loading: "CARREGANDO",
    username_label: "Nome de usuário",
    username_placeholder: "ex. sid",
    play_button: "Jogar",
    username_required_error: "Digite um nome de usuário primeiro.",
    connection_error: "Erro de conexão — tente novamente.",
    sign_in_prompt: "🔐 Entre para ver suas estatísticas",
    auth_username_placeholder: "Nome de usuário",
    auth_password_placeholder: "Senha",
    sign_in_button: "Entrar",
    sign_up_button: "Cadastrar",
    my_stats_button: "📊 Minhas Estatísticas",
    sign_out_button: "Sair",
    signed_in_as: "Conectado como {name}",
    my_stats_title: "📊 Minhas Estatísticas",
    stat_games_played: "Partidas jogadas",
    stat_best_score: "Melhor pontuação",
    stat_total_score: "Pontuação total",
    stat_last_played: "Última partida",
    stat_never: "—",
    close_button: "Fechar",
    round_progress: "Rodada {round}/{total}",
    round_one_banner: "Coma os emojis que combinam com a palavra-chave — os demais custam uma vida. Corra até a 🚩!",
    next_round_in: "Próxima rodada em {seconds}…",
    next_round_now: "Próxima rodada…",
    persistent_hint: "Use as setas para se mover. Corra até a 🚩!",
    game_over_title: "Fim de Jogo",
    final_score: "🏆 Pontuação final: {score}",
    all_time_leaderboard_heading: "Classificação geral",
    play_again_button: "Jogar Novamente",
    home_button: "🏠 Início",
    all_time_score_summary: "melhor 🏆 {score} · {games} partidas",
  },
  ru: {
    app_title: "😋 Пожиратели Эмодзи",
    app_tagline: "Съешьте все эмодзи, подходящие под ключевое слово. Остальные стоят вам жизни.",
    back_to_launchpad: "ВЕРНУТЬСЯ НА БАЗУ",
    loading: "ЗАГРУЗКА",
    username_label: "Имя пользователя",
    username_placeholder: "напр. sid",
    play_button: "Играть",
    username_required_error: "Сначала введите имя пользователя.",
    connection_error: "Ошибка соединения — попробуйте снова.",
    sign_in_prompt: "🔐 Войдите, чтобы видеть свою статистику",
    auth_username_placeholder: "Имя пользователя",
    auth_password_placeholder: "Пароль",
    sign_in_button: "Войти",
    sign_up_button: "Зарегистрироваться",
    my_stats_button: "📊 Моя статистика",
    sign_out_button: "Выйти",
    signed_in_as: "Вы вошли как {name}",
    my_stats_title: "📊 Моя статистика",
    stat_games_played: "Сыграно игр",
    stat_best_score: "Лучший результат",
    stat_total_score: "Общий счёт",
    stat_last_played: "Последняя игра",
    stat_never: "—",
    close_button: "Закрыть",
    round_progress: "Раунд {round}/{total}",
    round_one_banner: "Ешьте эмодзи, подходящие под ключевое слово — остальные стоят вам жизни. Бегите к 🚩!",
    next_round_in: "Следующий раунд через {seconds}…",
    next_round_now: "Следующий раунд…",
    persistent_hint: "Стрелки — для движения. Бегите к 🚩!",
    game_over_title: "Игра окончена",
    final_score: "🏆 Итоговый счёт: {score}",
    all_time_leaderboard_heading: "Таблица рекордов",
    play_again_button: "Играть снова",
    home_button: "🏠 Домой",
    all_time_score_summary: "лучший 🏆 {score} · игр: {games}",
  },
};

function t(key, vars) {
  const table = I18N_STRINGS[resolveI18nLang()] || I18N_STRINGS.en;
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
