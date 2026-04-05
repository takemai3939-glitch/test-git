// ===========================
// 定数定義
// ===========================

// 各指標のスコアウェイト（合計100）
const SCORE_WEIGHTS = {
  vix: 13,
  usdjpy: 8,
  us10y: 7,
  nasdaq: 11,
  sp500: 9,
  nikkeiFutures: 11,
  advDecline: 8,
  volume: 5,
  shortRatio: 5,
  tokoRachi: 6,
  marginPL: 6,
  foreignFlow: 11,
};
// Sum = 100

// イベント1件あたりのペナルティ
const EVENT_PENALTY = 5;

// 監視キーワードリスト
const WATCH_KEYWORDS = [
  'トランプ', '関税', '中国', '台湾', '中東', 'インフレ',
  '停戦', '利下げ', 'CPI', '雇用統計', '日銀', '円高', '円安', '半導体'
];

// サンプル値（初期表示用）
const SAMPLE_VALUES = {
  vix: 19.5, usdjpy: 149.80, us10y: 4.25,
  nasdaq: 0.85, sp500: 0.60, nikkeiFutures: 0.40,
  advances: 1150, declines: 680, volume: 3.8,
  shortRatio: 44.5, tokoRachi: 102.0, marginPL: -9.5,
  foreignFlow: 350,
  newsMemo: '半導体株が堅調。米国ではCPI発表を週内に控えている。',
  trumpMemo: '特段のトランプ発言なし。関税懸念は引き続き残存。',
  bojEvent: false, fomcEvent: false,
};

// ローカルストレージキー
const STORAGE_KEY = 'japan-stock-monitor-v1';

// ===========================
// 正規化関数（各指標 -1.0〜+1.0 を返す）
// ===========================

// VIX: 低いほどリスクオン＝プラス
function normVIX(v) {
  if (v === null || isNaN(v)) return 0;
  if (v < 14)  return  1.0;
  if (v < 17)  return  0.7;
  if (v < 20)  return  0.3;
  if (v < 23)  return  0.0;
  if (v < 27)  return -0.4;
  if (v < 32)  return -0.7;
  return -1.0;
}

// USD/JPY: 円安 = プラス（輸出株にプラス）
function normUSDJPY(v) {
  if (v === null || isNaN(v)) return 0;
  if (v > 158)  return  1.0;
  if (v > 153)  return  0.7;
  if (v > 148)  return  0.3;
  if (v > 143)  return  0.0;
  if (v > 138)  return -0.4;
  if (v > 133)  return -0.7;
  return -1.0;
}

// 米10年債利回り: 低金利 = グロース・株式にプラス
function normUS10Y(v) {
  if (v === null || isNaN(v)) return 0;
  if (v < 3.0)  return  1.0;
  if (v < 3.5)  return  0.6;
  if (v < 4.0)  return  0.2;
  if (v < 4.5)  return -0.2;
  if (v < 5.0)  return -0.6;
  return -1.0;
}

// 騰落率（NASDAQ / S&P500 / 日経先物 共通）
function normReturn(v) {
  if (v === null || isNaN(v)) return 0;
  if (v >  2.0)  return  1.0;
  if (v >  1.0)  return  0.7;
  if (v >  0.3)  return  0.3;
  if (v > -0.3)  return  0.0;
  if (v > -1.0)  return -0.3;
  if (v > -2.0)  return -0.7;
  return -1.0;
}

// 値上がり・値下がり銘柄比率
function normAdvDecline(adv, dec) {
  if (!adv || !dec || isNaN(adv) || isNaN(dec)) return 0;
  const total = adv + dec;
  if (total === 0) return 0;
  const ratio = adv / total;
  if (ratio > 0.75) return  1.0;
  if (ratio > 0.65) return  0.6;
  if (ratio > 0.55) return  0.2;
  if (ratio > 0.45) return  0.0;
  if (ratio > 0.35) return -0.3;
  if (ratio > 0.25) return -0.7;
  return -1.0;
}

// 売買代金（兆円）
function normVolume(v) {
  if (v === null || isNaN(v)) return 0;
  if (v > 5.0)  return  1.0;
  if (v > 4.0)  return  0.6;
  if (v > 3.0)  return  0.2;
  if (v > 2.0)  return -0.2;
  if (v > 1.0)  return -0.6;
  return -1.0;
}

// 空売り比率（%）: 低いほど需給良好
function normShortRatio(v) {
  if (v === null || isNaN(v)) return 0;
  if (v < 38)  return  1.0;
  if (v < 42)  return  0.5;
  if (v < 46)  return  0.1;
  if (v < 50)  return -0.4;
  if (v < 55)  return -0.7;
  return -1.0;
}

// 騰落レシオ: 100〜120が健全。120超は過熱。
function normTokoRachi(v) {
  if (v === null || isNaN(v)) return 0;
  if (v > 140) return -0.3;
  if (v > 120) return  0.3;
  if (v > 100) return  0.8;
  if (v > 80)  return  0.2;
  if (v > 60)  return -0.4;
  return -1.0;
}

// 信用評価損益率: 悪化しすぎると逆張り的プラスだが需給面では注意
function normMarginPL(v) {
  if (v === null || isNaN(v)) return 0;
  if (v < -25)  return  0.8;  // 極端な悪化 = 逆張り機会
  if (v < -15)  return  0.4;
  if (v < -8)   return  0.0;
  if (v < -3)   return -0.3;
  if (v <  0)   return -0.5;
  return -0.8;  // 含み益過大 = 利食い売り圧力
}

// 海外投資家フロー（億円）
function normForeignFlow(v) {
  if (v === null || isNaN(v)) return 0;
  if (v >  2000) return  1.0;
  if (v >  800)  return  0.7;
  if (v >  200)  return  0.3;
  if (v > -200)  return  0.0;
  if (v > -800)  return -0.4;
  if (v > -2000) return -0.7;
  return -1.0;
}

// ===========================
// スコア計算
// ===========================

/**
 * 入力データからスコアを計算する
 * @param {object} data - フォームデータ
 * @returns {{ score: number, breakdown: array, eventPenalty: number }}
 */
function calculateScore(data) {
  // 各指標の正規化値・ラベル・ウェイトを配列で定義
  const items = [
    {
      key: 'vix',
      label: 'VIX',
      weight: SCORE_WEIGHTS.vix,
      normalized: normVIX(data.vix),
    },
    {
      key: 'usdjpy',
      label: 'USD/JPY',
      weight: SCORE_WEIGHTS.usdjpy,
      normalized: normUSDJPY(data.usdjpy),
    },
    {
      key: 'us10y',
      label: '米10年債',
      weight: SCORE_WEIGHTS.us10y,
      normalized: normUS10Y(data.us10y),
    },
    {
      key: 'nasdaq',
      label: 'NASDAQ',
      weight: SCORE_WEIGHTS.nasdaq,
      normalized: normReturn(data.nasdaq),
    },
    {
      key: 'sp500',
      label: 'S&P500',
      weight: SCORE_WEIGHTS.sp500,
      normalized: normReturn(data.sp500),
    },
    {
      key: 'nikkeiFutures',
      label: '日経先物',
      weight: SCORE_WEIGHTS.nikkeiFutures,
      normalized: normReturn(data.nikkeiFutures),
    },
    {
      key: 'advDecline',
      label: '騰落銘柄比',
      weight: SCORE_WEIGHTS.advDecline,
      normalized: normAdvDecline(data.advances, data.declines),
    },
    {
      key: 'volume',
      label: '売買代金',
      weight: SCORE_WEIGHTS.volume,
      normalized: normVolume(data.volume),
    },
    {
      key: 'shortRatio',
      label: '空売り比率',
      weight: SCORE_WEIGHTS.shortRatio,
      normalized: normShortRatio(data.shortRatio),
    },
    {
      key: 'tokoRachi',
      label: '騰落レシオ',
      weight: SCORE_WEIGHTS.tokoRachi,
      normalized: normTokoRachi(data.tokoRachi),
    },
    {
      key: 'marginPL',
      label: '信用評価損益',
      weight: SCORE_WEIGHTS.marginPL,
      normalized: normMarginPL(data.marginPL),
    },
    {
      key: 'foreignFlow',
      label: '海外フロー',
      weight: SCORE_WEIGHTS.foreignFlow,
      normalized: normForeignFlow(data.foreignFlow),
    },
  ];

  // 基準スコア50から各指標の寄与度を加算
  let raw = 50;
  for (const item of items) {
    item.contribution = item.weight * item.normalized;
    raw += item.contribution;
  }

  // イベントペナルティ計算
  let eventPenalty = 0;
  if (data.bojEvent) eventPenalty += EVENT_PENALTY;
  if (data.fomcEvent) eventPenalty += EVENT_PENALTY;

  // 最終スコアを0〜100に丸める
  const score = Math.max(0, Math.min(100, Math.round(raw - eventPenalty)));

  return { score, breakdown: items, eventPenalty };
}

// ===========================
// ヘルパー関数
// ===========================

/**
 * スコアから判定ラベルとカラークラスを返す
 */
function getJudgment(score) {
  if (score >= 80) return { label: 'かなり強い需給', colorClass: 'very-strong', bgClass: 'bg-very-strong' };
  if (score >= 60) return { label: '強め',          colorClass: 'strong',      bgClass: 'bg-strong' };
  if (score >= 40) return { label: '中立',          colorClass: 'neutral',     bgClass: 'bg-neutral' };
  if (score >= 20) return { label: '弱め',          colorClass: 'weak',        bgClass: 'bg-weak' };
  return             { label: 'かなり弱い需給',     colorClass: 'very-weak',   bgClass: 'bg-very-weak' };
}

/**
 * スコアからバーのカラークラスを返す
 */
function getBarColorClass(score) {
  if (score >= 80) return 'bar-very-strong';
  if (score >= 60) return 'bar-strong';
  if (score >= 40) return 'bar-neutral';
  if (score >= 20) return 'bar-weak';
  return 'bar-very-weak';
}

/**
 * スコアからアラートレベルを返す
 */
function getAlertLevel(score) {
  if (score >= 75) return '低（警戒不要）';
  if (score >= 55) return '中（通常注意）';
  if (score >= 35) return '中高（要注視）';
  return '高（要警戒）';
}

/**
 * スコアからリスク分類を返す
 */
function getRiskClassification(score) {
  if (score >= 65) return 'リスクオン';
  if (score >= 40) return '中立';
  return 'リスクオフ';
}

// ===========================
// コメント生成
// ===========================

/**
 * 判定コメントを生成する
 * @param {object} data - フォームデータ
 * @param {number} score - 計算済みスコア
 * @returns {string} - 日本語コメント
 */
function generateComment(data, score) {
  const parts = [];

  // 1. VIX コメント
  if (data.vix !== null && !isNaN(data.vix)) {
    if (data.vix >= 30) {
      parts.push(`VIXが${data.vix}と高止まりしており、外部環境はリスクオフ状態です。`);
    } else if (data.vix >= 22) {
      parts.push(`VIXが${data.vix}とやや高め。市場には不安定感が残っています。`);
    } else if (data.vix < 16) {
      parts.push(`VIXが${data.vix}と低水準で、外部環境は落ち着いています。`);
    }
  }

  // 2. USD/JPY コメント
  if (data.usdjpy !== null && !isNaN(data.usdjpy)) {
    if (data.usdjpy < 138) {
      parts.push(`ドル円が${data.usdjpy}円と円高水準にあり、輸出株・外需株への逆風が懸念されます。`);
    } else if (data.usdjpy > 155) {
      parts.push(`ドル円が${data.usdjpy}円と円安水準で、輸出関連株にメリットが出やすい環境です。`);
    }
  }

  // 3. 米国株コメント（NASDAQ・S&P500）
  if (data.nasdaq !== null && data.sp500 !== null && !isNaN(data.nasdaq) && !isNaN(data.sp500)) {
    if (data.nasdaq > 1.0 || data.sp500 > 1.0) {
      parts.push(`米国株が堅調（NASDAQ: ${data.nasdaq}%、S&P500: ${data.sp500}%）で、リスクオンの流れが日本株にも好影響を与えやすい状況です。`);
    } else if (data.nasdaq < -1.0 || data.sp500 < -1.0) {
      parts.push(`米国株が軟調（NASDAQ: ${data.nasdaq}%、S&P500: ${data.sp500}%）。日本株への波及リスクに注意が必要です。`);
    }
  }

  // 4. 日経先物コメント
  if (data.nikkeiFutures !== null && !isNaN(data.nikkeiFutures)) {
    if (data.nikkeiFutures > 1.0) {
      parts.push(`日経先物が${data.nikkeiFutures}%高で、寄り付きから強い展開が期待されます。`);
    } else if (data.nikkeiFutures < -1.0) {
      parts.push(`日経先物が${data.nikkeiFutures}%安で、売り圧力に注意が必要です。`);
    }
  }

  // 5. 値上がり・値下がり比率コメント
  if (data.advances !== null && data.declines !== null && !isNaN(data.advances) && !isNaN(data.declines)) {
    const total = data.advances + data.declines;
    if (total > 0) {
      const ratio = data.advances / total;
      if (ratio > 0.70) {
        parts.push(`値上がり銘柄数が${data.advances}と広範な上昇で、内部指標が強い状態を示しています。`);
      } else if (ratio < 0.35) {
        parts.push(`値下がり銘柄数が${data.declines}と幅広い売りが出ており、市場全体の軟調さが目立ちます。`);
      }
    }
  }

  // 6. 空売り比率コメント
  if (data.shortRatio !== null && !isNaN(data.shortRatio)) {
    if (data.shortRatio > 50) {
      parts.push(`空売り比率が${data.shortRatio}%と高水準で、相場反転時の踏み上げ余地が大きいとも言えます。`);
    } else if (data.shortRatio < 40) {
      parts.push(`空売り比率が${data.shortRatio}%と低水準で、市場センチメントは良好です。`);
    }
  }

  // 7. 信用評価損益率コメント
  if (data.marginPL !== null && !isNaN(data.marginPL)) {
    if (data.marginPL < -20) {
      parts.push(`信用評価損益率が${data.marginPL}%と大幅悪化しており、逆張りの機会として注目される局面です。`);
    } else if (data.marginPL > -3) {
      parts.push(`信用評価損益率が${data.marginPL}%と高水準（含み益過多）。利食い売りが出やすい状況に注意が必要です。`);
    }
  }

  // 8. 騰落レシオコメント
  if (data.tokoRachi !== null && !isNaN(data.tokoRachi)) {
    if (data.tokoRachi > 130) {
      parts.push(`騰落レシオが${data.tokoRachi}と過熱圏。短期的な過買いに注意が必要です。`);
    } else if (data.tokoRachi < 70) {
      parts.push(`騰落レシオが${data.tokoRachi}と売られすぎ圏。リバウンドの可能性があります。`);
    }
  }

  // 9. キーワード検出コメント（ニュースメモ + トランプメモ）
  const allText = (data.newsMemo || '') + ' ' + (data.trumpMemo || '');

  if (allText.includes('トランプ') || allText.includes('関税')) {
    parts.push('関税・トランプ発言に関するヘッドラインリスクに注意してください。');
  }

  if (allText.includes('中東') || allText.includes('台湾')) {
    parts.push('地政学リスク（中東・台湾）が市場の不確実性を高めています。');
  }

  if (allText.includes('半導体')) {
    parts.push('半導体関連セクターが注目されています。関連銘柄の動向を確認してください。');
  }

  if (allText.includes('利下げ') || allText.includes('CPI') || allText.includes('雇用統計')) {
    parts.push('金融政策・経済指標イベントが市場に影響を与える可能性があります。発表前後の動向に注意が必要です。');
  }

  if (allText.includes('日銀')) {
    parts.push('日銀関連の報道があります。円相場・金利動向を確認してください。');
  }

  if (allText.includes('停戦')) {
    parts.push('停戦報道がリスクオンムードをサポートする可能性があります。');
  }

  if (allText.includes('円高')) {
    parts.push('円高進行が輸出株・外需株の収益に影響する可能性があります。');
  }

  // 10. イベントコメント
  if (data.bojEvent) {
    parts.push('本日は日銀イベントがあります。政策変更・発言内容によっては市場が大きく動く可能性があります。');
  }

  if (data.fomcEvent) {
    parts.push('FOMC・CPI等の重要イベントがあります。米国金融政策の方向性への注目が高まっています。');
  }

  // 11. スコアサマリー（必須）
  if (score >= 75) {
    parts.push('【総括】総じて需給良好な環境です。モメンタム継続に期待できる局面です。');
  } else if (score >= 60) {
    parts.push('【総括】やや強めの需給環境です。強気目線を維持しつつ、リスク管理を怠らないようにしましょう。');
  } else if (score >= 40) {
    parts.push('【総括】中立的な需給環境です。銘柄選別を重視した対応が求められます。');
  } else if (score >= 25) {
    parts.push('【総括】需給は弱め。慎重なポジション管理を心がけてください。');
  } else {
    parts.push('【総括】需給環境が厳しい状況です。リスク管理を最優先に、ポジションを抑制することを推奨します。');
  }

  return parts.join('\n');
}

// ===========================
// キーワード検出
// ===========================

/**
 * テキストから監視キーワードを検出する
 * @param {string} text - 検索対象テキスト
 * @returns {string[]} - 検出されたキーワード配列
 */
function detectKeywords(text) {
  if (!text) return [];
  return WATCH_KEYWORDS.filter(kw => text.includes(kw));
}

// ===========================
// データ入出力
// ===========================

/**
 * フォームからデータを取得する
 * @returns {object} - フォームデータ
 */
function getFormData() {
  // 数値フィールドの取得ヘルパー
  function getNum(id) {
    const el = document.getElementById(id);
    if (!el) return null;
    const v = parseFloat(el.value);
    return isNaN(v) ? null : v;
  }

  // テキストエリアの取得ヘルパー
  function getText(id) {
    const el = document.getElementById(id);
    if (!el) return '';
    return el.value.trim();
  }

  // チェックボックスの取得ヘルパー
  function getCheck(id) {
    const el = document.getElementById(id);
    if (!el) return false;
    return el.checked;
  }

  return {
    vix: getNum('vix'),
    usdjpy: getNum('usdjpy'),
    us10y: getNum('us10y'),
    nasdaq: getNum('nasdaq'),
    sp500: getNum('sp500'),
    nikkeiFutures: getNum('nikkei-futures'),
    advances: getNum('advances'),
    declines: getNum('declines'),
    volume: getNum('volume'),
    shortRatio: getNum('short-ratio'),
    tokoRachi: getNum('toko-rachi'),
    marginPL: getNum('margin-pl'),
    foreignFlow: getNum('foreign-flow'),
    newsMemo: getText('news-memo'),
    trumpMemo: getText('trump-memo'),
    bojEvent: getCheck('boj-event'),
    fomcEvent: getCheck('fomc-event'),
  };
}

/**
 * データをフォームにセットする
 * @param {object} data - セットするデータ
 */
function setFormData(data) {
  // 数値フィールドのセットヘルパー
  function setNum(id, val) {
    const el = document.getElementById(id);
    if (!el) return;
    el.value = (val !== null && val !== undefined) ? val : '';
  }

  // テキストエリアのセットヘルパー
  function setText(id, val) {
    const el = document.getElementById(id);
    if (!el) return;
    el.value = val || '';
  }

  // チェックボックスのセットヘルパー
  function setCheck(id, val) {
    const el = document.getElementById(id);
    if (!el) return;
    el.checked = !!val;
  }

  setNum('vix', data.vix);
  setNum('usdjpy', data.usdjpy);
  setNum('us10y', data.us10y);
  setNum('nasdaq', data.nasdaq);
  setNum('sp500', data.sp500);
  setNum('nikkei-futures', data.nikkeiFutures);
  setNum('advances', data.advances);
  setNum('declines', data.declines);
  setNum('volume', data.volume);
  setNum('short-ratio', data.shortRatio);
  setNum('toko-rachi', data.tokoRachi);
  setNum('margin-pl', data.marginPL);
  setNum('foreign-flow', data.foreignFlow);
  setText('news-memo', data.newsMemo);
  setText('trump-memo', data.trumpMemo);
  setCheck('boj-event', data.bojEvent);
  setCheck('fomc-event', data.fomcEvent);
}

// ===========================
// ローカルストレージ
// ===========================

/**
 * データをローカルストレージに保存する
 */
function saveToStorage(data) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
}

/**
 * ローカルストレージからデータを読み込む
 * @returns {object|null} - 保存データまたはnull
 */
function loadFromStorage() {
  try {
    const r = localStorage.getItem(STORAGE_KEY);
    return r ? JSON.parse(r) : null;
  } catch {
    return null;
  }
}

// ===========================
// 結果UI更新
// ===========================

/**
 * 結果パネルのUIを更新する
 * @param {number} score - スコア
 * @param {array} breakdown - 指標ブレークダウン
 * @param {number} eventPenalty - イベントペナルティ
 * @param {string} comment - 判定コメント
 * @param {object} data - 入力データ
 */
function updateResultUI(score, breakdown, eventPenalty, comment, data) {
  const judgment = getJudgment(score);
  const barColorClass = getBarColorClass(score);

  // 1. スコア値を更新
  const scoreEl = document.getElementById('score-value');
  scoreEl.textContent = score;
  // 既存のカラークラスを除去して新しいクラスを追加
  scoreEl.classList.remove('very-strong', 'strong', 'neutral', 'weak', 'very-weak');
  scoreEl.classList.add(judgment.colorClass);

  // 2. スコアバーを更新
  const barEl = document.getElementById('score-bar');
  barEl.style.width = score + '%';
  barEl.classList.remove('bar-very-strong', 'bar-strong', 'bar-neutral', 'bar-weak', 'bar-very-weak');
  barEl.classList.add(barColorClass);

  // 3. 判定ラベルを更新
  const judgmentEl = document.getElementById('judgment-label');
  judgmentEl.textContent = judgment.label;
  judgmentEl.classList.remove(
    'very-strong', 'strong', 'neutral', 'weak', 'very-weak',
    'bg-very-strong', 'bg-strong', 'bg-neutral', 'bg-weak', 'bg-very-weak'
  );
  judgmentEl.classList.add(judgment.colorClass, judgment.bgClass);

  // 4. アラートレベル・リスク分類を更新
  const alertEl = document.getElementById('alert-level');
  if (alertEl) alertEl.textContent = getAlertLevel(score);

  const riskEl = document.getElementById('risk-classification');
  if (riskEl) riskEl.textContent = getRiskClassification(score);

  // 5. コメントを更新（改行をbrタグに変換）
  const commentEl = document.getElementById('comment-text');
  if (commentEl) {
    commentEl.innerHTML = comment.replace(/\n/g, '<br>');
  }

  // 6. ブレークダウンテーブルを構築
  const tableEl = document.getElementById('breakdown-table');
  if (tableEl) {
    tableEl.innerHTML = '';

    // 各指標の行を生成
    for (const item of breakdown) {
      const row = document.createElement('div');
      row.className = 'breakdown-row';

      // 指標名
      const nameEl = document.createElement('span');
      nameEl.className = 'breakdown-name';
      nameEl.textContent = item.label;

      // バーラッパー
      const barWrap = document.createElement('div');
      barWrap.className = 'breakdown-bar-wrap';

      // 中央線
      const centerLine = document.createElement('div');
      centerLine.className = 'breakdown-bar-center';

      // バーフィル（正負で左位置と幅を切り替え）
      const barFill = document.createElement('div');
      barFill.className = 'breakdown-bar-fill';

      if (item.normalized > 0) {
        // 正の寄与: 中央から右に伸びる
        barFill.style.left = '50%';
        barFill.style.width = (item.normalized * 50) + '%';
        barFill.style.background = '#4ade80';
      } else if (item.normalized < 0) {
        // 負の寄与: 中央から左に伸びる
        const absNorm = Math.abs(item.normalized);
        barFill.style.left = (50 - absNorm * 50) + '%';
        barFill.style.width = (absNorm * 50) + '%';
        barFill.style.background = '#f97316';
      } else {
        // ゼロ: 表示なし
        barFill.style.width = '0%';
        barFill.style.background = '#555';
      }

      barWrap.appendChild(centerLine);
      barWrap.appendChild(barFill);

      // 寄与度表示
      const contribEl = document.createElement('span');
      contribEl.className = 'breakdown-contrib';
      const contrib = item.contribution;
      if (contrib > 0) {
        contribEl.textContent = '+' + contrib.toFixed(1);
        contribEl.style.color = '#4ade80';
      } else if (contrib < 0) {
        contribEl.textContent = contrib.toFixed(1);
        contribEl.style.color = '#f97316';
      } else {
        contribEl.textContent = '0.0';
        contribEl.style.color = '#555';
      }

      row.appendChild(nameEl);
      row.appendChild(barWrap);
      row.appendChild(contribEl);
      tableEl.appendChild(row);
    }

    // イベントペナルティの行を追加（ペナルティがある場合）
    if (eventPenalty > 0) {
      const penaltyRow = document.createElement('div');
      penaltyRow.className = 'breakdown-row';

      const penaltyName = document.createElement('span');
      penaltyName.className = 'breakdown-name';
      penaltyName.textContent = 'イベント補正';

      const penaltyBarWrap = document.createElement('div');
      penaltyBarWrap.className = 'breakdown-bar-wrap';

      const penaltyCenterLine = document.createElement('div');
      penaltyCenterLine.className = 'breakdown-bar-center';

      const penaltyBarFill = document.createElement('div');
      penaltyBarFill.className = 'breakdown-bar-fill';
      // ペナルティは常に負の方向
      const penaltyNorm = Math.min(eventPenalty / 10, 1.0);
      penaltyBarFill.style.left = (50 - penaltyNorm * 50) + '%';
      penaltyBarFill.style.width = (penaltyNorm * 50) + '%';
      penaltyBarFill.style.background = '#f87171';

      penaltyBarWrap.appendChild(penaltyCenterLine);
      penaltyBarWrap.appendChild(penaltyBarFill);

      const penaltyContrib = document.createElement('span');
      penaltyContrib.className = 'breakdown-contrib';
      penaltyContrib.textContent = '-' + eventPenalty.toFixed(1);
      penaltyContrib.style.color = '#f87171';

      penaltyRow.appendChild(penaltyName);
      penaltyRow.appendChild(penaltyBarWrap);
      penaltyRow.appendChild(penaltyContrib);
      tableEl.appendChild(penaltyRow);
    }
  }

  // 7. キーワードアラートを更新
  const allText = (data.newsMemo || '') + ' ' + (data.trumpMemo || '');
  const keywords = detectKeywords(allText);

  const keywordAlertsEl = document.getElementById('keyword-alerts');
  const keywordTagsEl = document.getElementById('keyword-tags');

  if (keywords.length > 0 && keywordAlertsEl && keywordTagsEl) {
    keywordAlertsEl.style.display = 'block';
    keywordTagsEl.innerHTML = '';
    for (const kw of keywords) {
      const tag = document.createElement('span');
      tag.className = 'keyword-tag';
      tag.textContent = kw;
      keywordTagsEl.appendChild(tag);
    }
  } else if (keywordAlertsEl) {
    keywordAlertsEl.style.display = 'none';
  }
}

// ===========================
// 日付・時刻表示
// ===========================

/**
 * 現在日時を表示する
 */
function updateDate() {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  const hh = String(now.getHours()).padStart(2, '0');
  const mm = String(now.getMinutes()).padStart(2, '0');
  const dayNames = ['日', '月', '火', '水', '木', '金', '土'];
  const dow = dayNames[now.getDay()];

  const el = document.getElementById('current-date');
  if (el) {
    el.textContent = `${y}/${m}/${d}（${dow}） ${hh}:${mm}`;
  }
}

// ===========================
// メイン処理
// ===========================

/**
 * 需給判定を実行する
 */
function runJudgment() {
  // 1. フォームからデータ取得
  const data = getFormData();

  // 2. ローカルストレージに保存
  saveToStorage(data);

  // 3. スコア計算
  const { score, breakdown, eventPenalty } = calculateScore(data);

  // 4. コメント生成
  const comment = generateComment(data, score);

  // 5. UIを更新
  updateResultUI(score, breakdown, eventPenalty, comment, data);
}

/**
 * フォームをリセットする
 */
function resetForm() {
  // 全数値入力をクリア
  const numberInputs = document.querySelectorAll('input[type="number"]');
  numberInputs.forEach(el => { el.value = ''; });

  // テキストエリアをクリア
  const textareas = document.querySelectorAll('textarea');
  textareas.forEach(el => { el.value = ''; });

  // チェックボックスをクリア
  const checkboxes = document.querySelectorAll('input[type="checkbox"]');
  checkboxes.forEach(el => { el.checked = false; });

  // 結果表示をリセット
  const scoreEl = document.getElementById('score-value');
  if (scoreEl) {
    scoreEl.textContent = '--';
    scoreEl.classList.remove('very-strong', 'strong', 'neutral', 'weak', 'very-weak');
  }

  const barEl = document.getElementById('score-bar');
  if (barEl) {
    barEl.style.width = '0%';
    barEl.classList.remove('bar-very-strong', 'bar-strong', 'bar-neutral', 'bar-weak', 'bar-very-weak');
  }

  const judgmentEl = document.getElementById('judgment-label');
  if (judgmentEl) {
    judgmentEl.textContent = '--';
    judgmentEl.classList.remove(
      'very-strong', 'strong', 'neutral', 'weak', 'very-weak',
      'bg-very-strong', 'bg-strong', 'bg-neutral', 'bg-weak', 'bg-very-weak'
    );
  }

  const alertEl = document.getElementById('alert-level');
  if (alertEl) alertEl.textContent = '--';

  const riskEl = document.getElementById('risk-classification');
  if (riskEl) riskEl.textContent = '--';

  const commentEl = document.getElementById('comment-text');
  if (commentEl) commentEl.innerHTML = '判定ボタンを押すとコメントが表示されます。';

  const tableEl = document.getElementById('breakdown-table');
  if (tableEl) tableEl.innerHTML = '';

  const keywordAlertsEl = document.getElementById('keyword-alerts');
  if (keywordAlertsEl) keywordAlertsEl.style.display = 'none';

  // ローカルストレージから削除
  localStorage.removeItem(STORAGE_KEY);
}

// ===========================
// 初期化
// ===========================

document.addEventListener('DOMContentLoaded', () => {
  // 日付表示を初期化し、1分ごとに更新
  updateDate();
  setInterval(updateDate, 60000);

  // ボタンイベントを設定
  const btnJudge = document.getElementById('btn-judge');
  if (btnJudge) btnJudge.addEventListener('click', runJudgment);

  const btnReset = document.getElementById('btn-reset');
  if (btnReset) btnReset.addEventListener('click', resetForm);

  // 保存データがあればロード、なければサンプル値をセット
  const savedData = loadFromStorage();
  if (savedData) {
    setFormData(savedData);
  } else {
    setFormData(SAMPLE_VALUES);
  }

  // 初回判定を自動実行
  runJudgment();
});
