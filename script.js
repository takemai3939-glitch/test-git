// ===========================
// 定数定義
// ===========================

// 各指標のスコアウェイト（合計100）
// ── 設計根拠 ──────────────────────────────────────────────
// [外部環境 計54pt]
//   nikkeiFutures 14: 寄り付き方向を最も直接規定する。SGX/CME先物の動きがそのまま開始値に反映される。
//   vix          13: グローバルリスク温度計。30超で機関投資家のリスク管理ルールが作動し強制的なデリスクが発生。
//   nasdaq       12: 日本の半導体・テック株はNASDAQとの相関が高い。東エレク・アドテスト等がNASDAQに連動。
//   sp500         8: 米国市場全般の方向感を補完。NASDAQより分散度が高く、リスクセンチメントの確認に有効。
//   us10y         7: 高金利はグロース株バリュエーション圧縮に直結。ドル高/円安との複合効果で日本株への影響が複雑。
// [日本株固有 計32pt]
//   foreignFlow  11: 東証プライム売買の約65%を外国人が占める。彼らの買い越し/売り越しが需給を決定する。
//   advDecline   10: 騰落銘柄比率は「相場の幅」を示す。指数が強くても内部悪化なら需給は脆弱。
//   usdjpy        7: 輸出株・日経全体への為替影響。ただし急激な円安は介入リスクを呼ぶため一方向に評価しない。
// [テクニカル・センチメント 計14pt]
//   tokoRachi     6: 25日騰落レシオ。中期的な買われすぎ/売られすぎを示す定番指標。
//   shortRatio    5: 空売り比率はセンチメントの代理変数。高水準は需給悪化だが踏み上げポテンシャルとの二面性あり。
//   volume        4: 売買代金は方向性の「確度」を補強する。単独では方向不明のため低ウェイト。
//   marginPL      3: 信用評価損益率は遅行指標かつ逆張り的解釈が必要。需給面での直接影響が限定的なため低ウェイト。
// ─────────────────────────────────────────────────────────
const SCORE_WEIGHTS = {
  // 外部環境
  nikkeiFutures: 14,
  vix:           13,
  nasdaq:        12,
  sp500:          8,
  us10y:          7,
  // 日本株固有
  foreignFlow:   11,
  advDecline:    10,
  usdjpy:         7,
  // テクニカル・センチメント
  tokoRachi:      6,
  shortRatio:     5,
  volume:         4,
  marginPL:       3,
};
// 合計 = 100

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

// ── VIX ───────────────────────────────────────────────────
// 中立帯: 18〜22。20以下は市場が落ち着いており好環境。
// 30超は機関投資家のリスク管理ルールが発動し、強制的なポジション削減が起きる。
function normVIX(v) {
  if (v === null || isNaN(v)) return 0;
  if (v < 13)  return  1.0;
  if (v < 16)  return  0.8;
  if (v < 20)  return  0.4;
  if (v < 23)  return  0.0;
  if (v < 28)  return -0.5;
  if (v < 35)  return -0.8;
  return -1.0;
}

// ── USD/JPY ───────────────────────────────────────────────
// 円安は輸出株・日経全体にプラス。ただし155円超は介入リスクが意識されるため+1.0にしない。
// 中立帯: 143〜150円（2024〜2025年の「普通」の水準）
function normUSDJPY(v) {
  if (v === null || isNaN(v)) return 0;
  if (v > 155)  return  0.7;
  if (v > 150)  return  1.0;
  if (v > 145)  return  0.4;
  if (v > 140)  return  0.0;
  if (v > 135)  return -0.5;
  if (v > 130)  return -0.8;
  return -1.0;
}

// ── 米10年債利回り ────────────────────────────────────────
// 中立帯: 4.0〜4.5%（2024年以降の「新常態」）
function normUS10Y(v) {
  if (v === null || isNaN(v)) return 0;
  if (v < 3.5)  return  1.0;
  if (v < 4.0)  return  0.5;
  if (v < 4.5)  return  0.0;
  if (v < 5.0)  return -0.5;
  if (v < 5.5)  return -0.8;
  return -1.0;
}

// ── 米株騰落率（NASDAQ / S&P500 共通） ────────────────────
// ±0.5%未満はノイズ。±1.5%超で方向性が明確になる。
function normReturn(v) {
  if (v === null || isNaN(v)) return 0;
  if (v >  2.5)  return  1.0;
  if (v >  1.5)  return  0.7;
  if (v >  0.5)  return  0.3;
  if (v > -0.5)  return  0.0;
  if (v > -1.5)  return -0.4;
  if (v > -2.5)  return -0.7;
  return -1.0;
}

// ── 日経先物（専用関数）──────────────────────────────────
// 最重要指標。SGX/CMEの日経先物が翌朝の寄り付きに直接反映される。
function normNikkeiFutures(v) {
  if (v === null || isNaN(v)) return 0;
  if (v >  1.5)  return  1.0;
  if (v >  0.8)  return  0.6;
  if (v >  0.2)  return  0.2;
  if (v > -0.2)  return  0.0;
  if (v > -0.8)  return -0.4;
  if (v > -1.5)  return -0.7;
  return -1.0;
}

// ── 値上がり/値下がり銘柄比率 ────────────────────────────
// 東証プライム約2000銘柄ベース。0.5（50%）が中立。
function normAdvDecline(adv, dec) {
  if (!adv || !dec || isNaN(adv) || isNaN(dec)) return 0;
  const total = adv + dec;
  if (total === 0) return 0;
  const ratio = adv / total;
  if (ratio > 0.75) return  1.0;
  if (ratio > 0.65) return  0.6;
  if (ratio > 0.55) return  0.2;
  if (ratio > 0.45) return  0.0;
  if (ratio > 0.35) return -0.4;
  if (ratio > 0.25) return -0.7;
  return -1.0;
}

// ── 売買代金（兆円） ──────────────────────────────────────
// 近年の東証プライムの「普通の1日」は3〜4兆円。
function normVolume(v) {
  if (v === null || isNaN(v)) return 0;
  if (v > 5.0)  return  1.0;
  if (v > 4.0)  return  0.6;
  if (v > 3.0)  return  0.2;
  if (v > 2.0)  return -0.3;
  if (v > 1.5)  return -0.7;
  return -1.0;
}

// ── 空売り比率（%） ───────────────────────────────────────
// ETF設定・高頻度取引の影響で構造的に上昇傾向。2024年の中立帯は43〜47%程度。
function normShortRatio(v) {
  if (v === null || isNaN(v)) return 0;
  if (v < 40)  return  1.0;
  if (v < 43)  return  0.5;
  if (v < 47)  return  0.0;
  if (v < 51)  return -0.4;
  if (v < 55)  return -0.7;
  return -1.0;
}

// ── 騰落レシオ（25日）────────────────────────────────────
// 100が基準。100〜120が健全な上昇相場を示す最良の需給ゾーン。
function normTokoRachi(v) {
  if (v === null || isNaN(v)) return 0;
  if (v > 140) return -0.5;
  if (v > 120) return  0.3;
  if (v > 100) return  0.9;
  if (v >  85) return  0.1;
  if (v >  70) return -0.5;
  return -1.0;
}

// ── 信用評価損益率（%）────────────────────────────────────
function normMarginPL(v) {
  if (v === null || isNaN(v)) return 0;
  if (v < -20)  return  0.0;
  if (v < -12)  return -0.4;
  if (v <  -5)  return -0.1;
  if (v <   0)  return  0.1;
  return -0.6;
}

// ── 海外投資家フロー（億円）──────────────────────────────
// 東証プライム売買の約65%を外国人が占める最重要指標。
function normForeignFlow(v) {
  if (v === null || isNaN(v)) return 0;
  if (v >  2000) return  1.0;
  if (v >   800) return  0.7;
  if (v >   200) return  0.3;
  if (v >  -200) return  0.0;
  if (v >  -800) return -0.4;
  if (v > -2000) return -0.7;
  return -1.0;
}

// ===========================
// スコア計算
// ===========================

/**
 * 入力データからスコアを計算する
 * @param {object} data - フォームデータ
 * @returns {{ score: number, breakdown: array, eventPenalty: number, extNorm: number, intNorm: number }}
 */
function calculateScore(data) {
  const items = [
    { key: 'vix',           label: 'VIX',       weight: SCORE_WEIGHTS.vix,           normalized: normVIX(data.vix) },
    { key: 'usdjpy',        label: 'USD/JPY',   weight: SCORE_WEIGHTS.usdjpy,        normalized: normUSDJPY(data.usdjpy) },
    { key: 'us10y',         label: '米10年債',  weight: SCORE_WEIGHTS.us10y,         normalized: normUS10Y(data.us10y) },
    { key: 'nasdaq',        label: 'NASDAQ',    weight: SCORE_WEIGHTS.nasdaq,        normalized: normReturn(data.nasdaq) },
    { key: 'sp500',         label: 'S&P500',    weight: SCORE_WEIGHTS.sp500,         normalized: normReturn(data.sp500) },
    { key: 'nikkeiFutures', label: '日経先物',  weight: SCORE_WEIGHTS.nikkeiFutures, normalized: normNikkeiFutures(data.nikkeiFutures) },
    { key: 'advDecline',    label: '騰落銘柄比', weight: SCORE_WEIGHTS.advDecline,   normalized: normAdvDecline(data.advances, data.declines) },
    { key: 'volume',        label: '売買代金',  weight: SCORE_WEIGHTS.volume,        normalized: normVolume(data.volume) },
    { key: 'shortRatio',    label: '空売り比率', weight: SCORE_WEIGHTS.shortRatio,   normalized: normShortRatio(data.shortRatio) },
    { key: 'tokoRachi',     label: '騰落レシオ', weight: SCORE_WEIGHTS.tokoRachi,    normalized: normTokoRachi(data.tokoRachi) },
    { key: 'marginPL',      label: '信用評価損益', weight: SCORE_WEIGHTS.marginPL,   normalized: normMarginPL(data.marginPL) },
    { key: 'foreignFlow',   label: '海外フロー', weight: SCORE_WEIGHTS.foreignFlow,  normalized: normForeignFlow(data.foreignFlow) },
  ];

  // 基準スコア50から各指標の寄与度を加算
  let raw = 50;
  for (const item of items) {
    item.contribution = item.weight * item.normalized;
    raw += item.contribution;
  }

  // 外部環境・内部指標のサブスコアを計算（コメント生成での乖離検知に使用）
  const EXT_KEYS = ['vix', 'nasdaq', 'sp500', 'nikkeiFutures', 'us10y'];
  const INT_KEYS = ['advDecline', 'foreignFlow', 'usdjpy', 'volume', 'shortRatio', 'tokoRachi', 'marginPL'];
  const extItems = items.filter(i => EXT_KEYS.includes(i.key));
  const intItems = items.filter(i => INT_KEYS.includes(i.key));
  const extWt = extItems.reduce((s, i) => s + i.weight, 0);
  const intWt = intItems.reduce((s, i) => s + i.weight, 0);
  const extNorm = extWt > 0 ? extItems.reduce((s, i) => s + i.contribution, 0) / extWt : 0;
  const intNorm = intWt > 0 ? intItems.reduce((s, i) => s + i.contribution, 0) / intWt : 0;

  // イベントペナルティ計算
  let eventPenalty = 0;
  if (data.bojEvent) eventPenalty += EVENT_PENALTY;
  if (data.fomcEvent) eventPenalty += EVENT_PENALTY;

  const score = Math.max(0, Math.min(100, Math.round(raw - eventPenalty)));
  return { score, breakdown: items, eventPenalty, extNorm, intNorm };
}

// ===========================
// ヘルパー関数
// ===========================

function getJudgment(score) {
  if (score >= 80) return { label: 'かなり強い需給', colorClass: 'very-strong', bgClass: 'bg-very-strong' };
  if (score >= 60) return { label: '強め',          colorClass: 'strong',      bgClass: 'bg-strong' };
  if (score >= 40) return { label: '中立',          colorClass: 'neutral',     bgClass: 'bg-neutral' };
  if (score >= 20) return { label: '弱め',          colorClass: 'weak',        bgClass: 'bg-weak' };
  return             { label: 'かなり弱い需給',     colorClass: 'very-weak',   bgClass: 'bg-very-weak' };
}

function getAlertLevel(score) {
  if (score >= 75) return '低（警戒不要）';
  if (score >= 55) return '中（通常注意）';
  if (score >= 35) return '中高（要注視）';
  return '高（要警戒）';
}

function getRiskClassification(score) {
  if (score >= 65) return 'リスクオン';
  if (score >= 40) return '中立';
  return 'リスクオフ';
}

// ===========================
// コメント生成
// ===========================

function generateComment(data, score, context) {
  const parts = [];
  const ctx = context || { extNorm: 0, intNorm: 0 };

  if (data.vix !== null && !isNaN(data.vix)) {
    if (data.vix >= 30) {
      parts.push(`VIXが${data.vix}と高止まりしており、外部環境はリスクオフ状態です。`);
    } else if (data.vix >= 22) {
      parts.push(`VIXが${data.vix}とやや高め。市場には不安定感が残っています。`);
    } else if (data.vix < 16) {
      parts.push(`VIXが${data.vix}と低水準で、外部環境は落ち着いています。`);
    }
  }

  if (data.usdjpy !== null && !isNaN(data.usdjpy)) {
    if (data.usdjpy < 138) {
      parts.push(`ドル円が${data.usdjpy}円と円高水準にあり、輸出株・外需株への逆風が懸念されます。`);
    } else if (data.usdjpy > 155) {
      parts.push(`ドル円が${data.usdjpy}円と円安水準で、輸出関連株にメリットが出やすい環境です。`);
    }
  }

  if (data.nasdaq !== null && data.sp500 !== null && !isNaN(data.nasdaq) && !isNaN(data.sp500)) {
    if (data.nasdaq > 1.0 || data.sp500 > 1.0) {
      parts.push(`米国株が堅調（NASDAQ: ${data.nasdaq}%、S&P500: ${data.sp500}%）で、リスクオンの流れが日本株にも好影響を与えやすい状況です。`);
    } else if (data.nasdaq < -1.0 || data.sp500 < -1.0) {
      parts.push(`米国株が軟調（NASDAQ: ${data.nasdaq}%、S&P500: ${data.sp500}%）。日本株への波及リスクに注意が必要です。`);
    }
  }

  if (data.nikkeiFutures !== null && !isNaN(data.nikkeiFutures)) {
    if (data.nikkeiFutures > 1.0) {
      parts.push(`日経先物が${data.nikkeiFutures}%高で、寄り付きから強い展開が期待されます。`);
    } else if (data.nikkeiFutures < -1.0) {
      parts.push(`日経先物が${data.nikkeiFutures}%安で、売り圧力に注意が必要です。`);
    }
  }

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

  if (data.shortRatio !== null && !isNaN(data.shortRatio)) {
    if (data.shortRatio > 50) {
      parts.push(`空売り比率が${data.shortRatio}%と高水準で、相場反転時の踏み上げ余地が大きいとも言えます。`);
    } else if (data.shortRatio < 40) {
      parts.push(`空売り比率が${data.shortRatio}%と低水準で、市場センチメントは良好です。`);
    }
  }

  if (data.marginPL !== null && !isNaN(data.marginPL)) {
    if (data.marginPL < -20) {
      parts.push(`信用評価損益率が${data.marginPL}%と大幅悪化しており、逆張りの機会として注目される局面です。`);
    } else if (data.marginPL > -3) {
      parts.push(`信用評価損益率が${data.marginPL}%と高水準（含み益過多）。利食い売りが出やすい状況に注意が必要です。`);
    }
  }

  if (data.tokoRachi !== null && !isNaN(data.tokoRachi)) {
    if (data.tokoRachi > 130) {
      parts.push(`騰落レシオが${data.tokoRachi}と過熱圏。短期的な過買いに注意が必要です。`);
    } else if (data.tokoRachi < 70) {
      parts.push(`騰落レシオが${data.tokoRachi}と売られすぎ圏。リバウンドの可能性があります。`);
    }
  }

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

  // 外部環境・内部指標の乖離検知
  if (ctx.extNorm > 0.3 && ctx.intNorm < -0.2) {
    parts.push('【注目】外部環境（米株・VIX・先物）は強いが、内部指標（騰落比・海外フロー等）は弱い。上値の重い展開に注意が必要です。');
  } else if (ctx.extNorm < -0.2 && ctx.intNorm > 0.3) {
    parts.push('【注目】外部環境は弱いが、内部指標は底堅い。下値は限定的で、個別株が意外に健闘する可能性があります。');
  }

  if (data.bojEvent) {
    parts.push('本日は日銀イベントがあります。政策変更・発言内容によっては市場が大きく動く可能性があります。ポジションは慎重に。');
  }
  if (data.fomcEvent) {
    parts.push('FOMC・CPI等の重要イベントがあります。結果次第でドル・金利が大きく動き、日本株のボラティリティが高まる可能性があります。');
  }

  // スコアサマリー
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

function detectKeywords(text) {
  if (!text) return [];
  return WATCH_KEYWORDS.filter(kw => text.includes(kw));
}

// ===========================
// データ入出力
// ===========================

function getFormData() {
  function getNum(id) {
    const el = document.getElementById(id);
    if (!el) return null;
    const v = parseFloat(el.value);
    return isNaN(v) ? null : v;
  }
  function getText(id) {
    const el = document.getElementById(id);
    if (!el) return '';
    return el.value.trim();
  }
  function getCheck(id) {
    const el = document.getElementById(id);
    if (!el) return false;
    return el.checked;
  }

  return {
    vix:           getNum('vix'),
    usdjpy:        getNum('usdjpy'),
    us10y:         getNum('us10y'),
    nasdaq:        getNum('nasdaq'),
    sp500:         getNum('sp500'),
    nikkeiFutures: getNum('nikkei-futures'),
    advances:      getNum('advances'),
    declines:      getNum('declines'),
    volume:        getNum('volume'),
    shortRatio:    getNum('short-ratio'),
    tokoRachi:     getNum('toko-rachi'),
    marginPL:      getNum('margin-pl'),
    foreignFlow:   getNum('foreign-flow'),
    newsMemo:      getText('news-memo'),
    trumpMemo:     getText('trump-memo'),
    bojEvent:      getCheck('boj-event'),
    fomcEvent:     getCheck('fomc-event'),
  };
}

function setFormData(data) {
  function setNum(id, val) {
    const el = document.getElementById(id);
    if (!el) return;
    el.value = (val !== null && val !== undefined) ? val : '';
  }
  function setText(id, val) {
    const el = document.getElementById(id);
    if (!el) return;
    el.value = val || '';
  }
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

function saveToStorage(data) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
}

function loadFromStorage() {
  try {
    const r = localStorage.getItem(STORAGE_KEY);
    return r ? JSON.parse(r) : null;
  } catch {
    return null;
  }
}

// ===========================
// スコアリングUI更新
// ===========================

/**
 * SVGリングのアニメーション更新
 * @param {number} score 0–100
 */
function updateScoreRing(score) {
  const ringFill = document.getElementById('ring-fill');
  if (!ringFill) return;

  // 周長: 2 * π * 52 ≈ 326.73
  const CIRCUMFERENCE = 326.73;
  const offset = CIRCUMFERENCE * (1 - Math.max(0, Math.min(100, score)) / 100);
  ringFill.style.strokeDashoffset = offset;

  // スコアに応じてリングの色を変える
  const colorMap = {
    'very-strong': '#22c55e',
    'strong':      '#4ade80',
    'neutral':     '#eab308',
    'weak':        '#f97316',
    'very-weak':   '#ef4444'
  };
  ringFill.style.stroke = colorMap[getJudgment(score).colorClass] || '#6366f1';
}

/**
 * スコアに対応するスペクトラムバンドをアクティブにする
 * @param {number} score 0–100
 */
function updateScoreSpectrum(score) {
  document.querySelectorAll('.spectrum-band').forEach(band => {
    const min = parseInt(band.getAttribute('data-min'), 10);
    const max = parseInt(band.getAttribute('data-max'), 10);
    band.classList.toggle('active', score >= min && score <= max);
  });
}

/**
 * 結果パネルのUIを全更新する
 */
function updateResultUI(score, breakdown, eventPenalty, comment, data) {
  const judgment = getJudgment(score);

  // 1. スコアリング（リング＋数値）
  updateScoreRing(score);
  const scoreEl = document.getElementById('score-value');
  if (scoreEl) {
    scoreEl.textContent = score;
    scoreEl.classList.remove('very-strong', 'strong', 'neutral', 'weak', 'very-weak');
    scoreEl.classList.add(judgment.colorClass);
  }

  // 2. スペクトラム
  updateScoreSpectrum(score);

  // 3. 判定ラベル
  const judgmentEl = document.getElementById('judgment-label');
  if (judgmentEl) {
    judgmentEl.textContent = judgment.label;
    judgmentEl.classList.remove(
      'very-strong', 'strong', 'neutral', 'weak', 'very-weak',
      'bg-very-strong', 'bg-strong', 'bg-neutral', 'bg-weak', 'bg-very-weak'
    );
    judgmentEl.classList.add(judgment.colorClass, judgment.bgClass);
  }

  // 4. メタ情報
  const alertEl = document.getElementById('alert-level');
  if (alertEl) alertEl.textContent = getAlertLevel(score);

  const riskEl = document.getElementById('risk-classification');
  if (riskEl) riskEl.textContent = getRiskClassification(score);

  // 5. コメント
  const commentEl = document.getElementById('comment-text');
  if (commentEl) commentEl.innerHTML = comment.replace(/\n/g, '<br>');

  // 6. ブレークダウンテーブル
  const tableEl = document.getElementById('breakdown-table');
  if (tableEl) {
    tableEl.innerHTML = '';
    for (const item of breakdown) {
      const row = document.createElement('div');
      row.className = 'breakdown-row';

      const nameEl = document.createElement('span');
      nameEl.className = 'breakdown-name';
      nameEl.textContent = item.label;

      const barWrap = document.createElement('div');
      barWrap.className = 'breakdown-bar-wrap';
      const centerLine = document.createElement('div');
      centerLine.className = 'breakdown-bar-center';
      const barFill = document.createElement('div');
      barFill.className = 'breakdown-bar-fill';

      if (item.normalized > 0) {
        barFill.style.left = '50%';
        barFill.style.width = (item.normalized * 50) + '%';
        barFill.style.background = '#4ade80';
      } else if (item.normalized < 0) {
        const absNorm = Math.abs(item.normalized);
        barFill.style.left = (50 - absNorm * 50) + '%';
        barFill.style.width = (absNorm * 50) + '%';
        barFill.style.background = '#f97316';
      } else {
        barFill.style.width = '0%';
        barFill.style.background = '#555';
      }
      barWrap.appendChild(centerLine);
      barWrap.appendChild(barFill);

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

    // イベントペナルティ行
    if (eventPenalty > 0) {
      const penaltyRow = document.createElement('div');
      penaltyRow.className = 'breakdown-row';

      const pName = document.createElement('span');
      pName.className = 'breakdown-name';
      pName.textContent = 'イベント補正';

      const pBarWrap = document.createElement('div');
      pBarWrap.className = 'breakdown-bar-wrap';
      const pCenter = document.createElement('div');
      pCenter.className = 'breakdown-bar-center';
      const pFill = document.createElement('div');
      pFill.className = 'breakdown-bar-fill';
      const pNorm = Math.min(eventPenalty / 10, 1.0);
      pFill.style.left = (50 - pNorm * 50) + '%';
      pFill.style.width = (pNorm * 50) + '%';
      pFill.style.background = '#f87171';
      pBarWrap.appendChild(pCenter);
      pBarWrap.appendChild(pFill);

      const pContrib = document.createElement('span');
      pContrib.className = 'breakdown-contrib';
      pContrib.textContent = '-' + eventPenalty.toFixed(1);
      pContrib.style.color = '#f87171';

      penaltyRow.appendChild(pName);
      penaltyRow.appendChild(pBarWrap);
      penaltyRow.appendChild(pContrib);
      tableEl.appendChild(penaltyRow);
    }
  }

  // 7. キーワードアラート
  const allText = (data.newsMemo || '') + ' ' + (data.trumpMemo || '');
  const keywords = detectKeywords(allText);
  const keywordAlertsEl = document.getElementById('keyword-alerts');
  const keywordTagsEl   = document.getElementById('keyword-tags');

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

  // 8. 結果カードのフェードインアニメーション
  const resultCard = document.getElementById('result-card');
  if (resultCard) {
    resultCard.classList.remove('result-animate');
    void resultCard.offsetWidth; // reflow強制
    resultCard.classList.add('result-animate');
  }
}

// ===========================
// ヘルプボタン初期化
// ===========================

function initHelpButtons() {
  document.querySelectorAll('.help-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const targetId = btn.getAttribute('data-target');
      const helpEl = document.getElementById(targetId);
      if (!helpEl) return;
      const isHidden = helpEl.hidden;
      helpEl.hidden = !isHidden;
      btn.classList.toggle('active', isHidden);
    });
  });
}

// ===========================
// 日付・時刻表示
// ===========================

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
  if (el) el.textContent = `${y}/${m}/${d}（${dow}） ${hh}:${mm}`;
}

// ===========================
// メイン判定処理
// ===========================

function runJudgment(saveToHistory = false) {
  const data = getFormData();
  saveToStorage(data);
  const { score, breakdown, eventPenalty, extNorm, intNorm } = calculateScore(data);
  const comment = generateComment(data, score, { extNorm, intNorm });
  updateResultUI(score, breakdown, eventPenalty, comment, data);
  if (saveToHistory) addHistoryRecord(data, score, comment);
}

function resetForm() {
  document.querySelectorAll('input[type="number"]').forEach(el => { el.value = ''; });
  document.querySelectorAll('textarea').forEach(el => { el.value = ''; });
  document.querySelectorAll('input[type="checkbox"]').forEach(el => { el.checked = false; });

  const scoreEl = document.getElementById('score-value');
  if (scoreEl) {
    scoreEl.textContent = '--';
    scoreEl.classList.remove('very-strong', 'strong', 'neutral', 'weak', 'very-weak');
  }

  // リングをリセット
  const ringFill = document.getElementById('ring-fill');
  if (ringFill) {
    ringFill.style.strokeDashoffset = '326.73';
    ringFill.style.stroke = 'rgba(255,255,255,0.1)';
  }

  const judgmentEl = document.getElementById('judgment-label');
  if (judgmentEl) {
    judgmentEl.textContent = '判定待ち';
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
  if (commentEl) commentEl.innerHTML = 'フォームに数値を入力し「判定して結果を表示」を押してください。';

  const tableEl = document.getElementById('breakdown-table');
  if (tableEl) tableEl.innerHTML = '';

  const keywordAlertsEl = document.getElementById('keyword-alerts');
  if (keywordAlertsEl) keywordAlertsEl.style.display = 'none';

  // スペクトラムをリセット
  document.querySelectorAll('.spectrum-band').forEach(b => b.classList.remove('active'));

  localStorage.removeItem(STORAGE_KEY);
}

// ===========================
// 履歴機能
// ===========================

const HISTORY_KEY = 'japan-stock-monitor-history-v1';
const HISTORY_MAX = 30;

function loadHistory() {
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

function saveHistoryData(history) {
  try { localStorage.setItem(HISTORY_KEY, JSON.stringify(history)); } catch { /* storage unavailable */ }
}

function addHistoryRecord(data, score, comment) {
  const history = loadHistory();
  const record = {
    id: Date.now(),
    date: new Date().toISOString(),
    score,
    judgment: getJudgment(score).label,
    comment,
    data: { ...data },
  };
  history.unshift(record);
  if (history.length > HISTORY_MAX) history.splice(HISTORY_MAX);
  saveHistoryData(history);
  renderHistoryTable();
  renderScoreChart();
  showSaveToast();
}

// ===========================
// 保存完了トースト
// ===========================

function showSaveToast(msg = '履歴に保存しました') {
  const toast = document.getElementById('save-toast');
  if (!toast) return;
  toast.textContent = msg;
  toast.classList.remove('show');
  // 次フレームで追加してトランジションを発火
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      toast.classList.add('show');
      clearTimeout(toast._hideTimer);
      toast._hideTimer = setTimeout(() => toast.classList.remove('show'), 2600);
    });
  });
}

/**
 * 履歴をカードグリッドとして描画する
 */
function renderHistoryTable() {
  const history = loadHistory();

  const countEl  = document.getElementById('history-count');
  const emptyEl  = document.getElementById('history-empty');
  const scrollEl = document.getElementById('history-table-scroll');
  const tbodyEl  = document.getElementById('history-tbody');

  if (countEl) countEl.textContent = `${history.length}件`;

  if (history.length === 0) {
    if (emptyEl)  emptyEl.style.display  = 'block';
    if (scrollEl) scrollEl.style.display = 'none';
    return;
  }

  if (emptyEl)  emptyEl.style.display  = 'none';
  if (scrollEl) scrollEl.style.display = 'block';

  tbodyEl.innerHTML = '';

  for (const rec of history) {
    const d = new Date(rec.date);
    const dateStr = `${d.getMonth() + 1}/${d.getDate()} `
      + `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;

    const j = getJudgment(rec.score);

    const adv = rec.data.advances;
    const dec = rec.data.declines;
    const advRatioStr = (adv && dec && !isNaN(adv) && !isNaN(dec))
      ? Math.round(adv / (adv + dec) * 100) + '%'
      : '--';

    const futuresVal = rec.data.nikkeiFutures;
    const futuresStr = (futuresVal != null && !isNaN(futuresVal))
      ? (futuresVal >= 0 ? '+' : '') + futuresVal + '%'
      : '--';

    const card = document.createElement('div');
    card.className = 'hist-card';
    card.dataset.id = rec.id;
    card.innerHTML = `
      <div class="hist-card-top">
        <input type="checkbox" class="history-check" data-id="${rec.id}" aria-label="比較選択">
        <span class="hist-date">${dateStr}</span>
        <button class="btn-load-rec" data-id="${rec.id}">読込</button>
        <button class="btn-del-rec"  data-id="${rec.id}">削除</button>
      </div>
      <div class="hist-score-wrap">
        <span class="hist-score-num ${j.colorClass}">${rec.score}</span>
        <span class="hist-judgment ${j.colorClass}">${j.label}</span>
      </div>
      <div class="hist-metrics">
        <div class="hist-metric-item"><span class="hm-label">VIX</span><span class="hm-val">${rec.data.vix ?? '--'}</span></div>
        <div class="hist-metric-item"><span class="hm-label">ドル円</span><span class="hm-val">${rec.data.usdjpy ?? '--'}</span></div>
        <div class="hist-metric-item"><span class="hm-label">先物</span><span class="hm-val">${futuresStr}</span></div>
        <div class="hist-metric-item"><span class="hm-label">騰落比</span><span class="hm-val">${advRatioStr}</span></div>
      </div>
    `;
    tbodyEl.appendChild(card);
  }

  // イベントリスナー
  tbodyEl.querySelectorAll('.history-check').forEach(cb => {
    cb.addEventListener('change', onCheckboxChange);
  });
  tbodyEl.querySelectorAll('.btn-load-rec').forEach(btn => {
    btn.addEventListener('click', e => loadHistoryRecord(Number(e.currentTarget.dataset.id)));
  });
  tbodyEl.querySelectorAll('.btn-del-rec').forEach(btn => {
    btn.addEventListener('click', e => deleteHistoryRecord(Number(e.currentTarget.dataset.id)));
  });
}

function onCheckboxChange() {
  const checked   = [...document.querySelectorAll('.history-check:checked')];
  const unchecked = [...document.querySelectorAll('.history-check:not(:checked)')];
  const btnCompare = document.getElementById('btn-compare');
  if (btnCompare) btnCompare.disabled = checked.length !== 2;
  unchecked.forEach(cb => { cb.disabled = checked.length >= 2; });
}

function loadHistoryRecord(id) {
  const rec = loadHistory().find(r => r.id === id);
  if (!rec) return;
  setFormData(rec.data);
  runJudgment(false);
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function deleteHistoryRecord(id) {
  const history = loadHistory().filter(r => r.id !== id);
  saveHistoryData(history);
  renderHistoryTable();
  renderScoreChart();
  const panel = document.getElementById('comparison-panel');
  if (panel) panel.style.display = 'none';
}

function showComparison() {
  const checked = [...document.querySelectorAll('.history-check:checked')];
  if (checked.length !== 2) return;
  const history = loadHistory();
  const ids = checked.map(cb => Number(cb.dataset.id));
  const [recA, recB] = ids.map(id => history.find(r => r.id === id));
  if (!recA || !recB) return;
  renderComparison(recA, recB);
  const panel = document.getElementById('comparison-panel');
  if (panel) {
    panel.style.display = 'block';
    panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
}

function renderComparison(recA, recB) {
  const body = document.getElementById('comparison-body');
  if (!body) return;

  const fmtDate = iso => {
    const d = new Date(iso);
    return `${d.getMonth() + 1}/${d.getDate()} `
      + `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  };

  const jA = getJudgment(recA.score);
  const jB = getJudgment(recB.score);
  const delta = recB.score - recA.score;
  const deltaClass = delta > 0 ? 'positive' : delta < 0 ? 'negative' : 'zero';
  const deltaStr = delta > 0 ? `+${delta}` : `${delta}`;

  const METRICS = [
    { label: 'スコア',       kA: recA.score,             kB: recB.score,             unit: '',   better: true  },
    { label: 'VIX',          kA: recA.data.vix,           kB: recB.data.vix,           unit: '',   better: false },
    { label: 'ドル円',        kA: recA.data.usdjpy,        kB: recB.data.usdjpy,        unit: '円', better: true  },
    { label: '米10年金利',    kA: recA.data.us10y,         kB: recB.data.us10y,         unit: '%',  better: false },
    { label: 'NASDAQ',       kA: recA.data.nasdaq,        kB: recB.data.nasdaq,        unit: '%',  better: true  },
    { label: 'S&P500',       kA: recA.data.sp500,         kB: recB.data.sp500,         unit: '%',  better: true  },
    { label: '日経先物',      kA: recA.data.nikkeiFutures, kB: recB.data.nikkeiFutures, unit: '%',  better: true  },
    { label: '値上がり銘柄',  kA: recA.data.advances,      kB: recB.data.advances,      unit: '',   better: true  },
    { label: '値下がり銘柄',  kA: recA.data.declines,      kB: recB.data.declines,      unit: '',   better: false },
    { label: '売買代金',      kA: recA.data.volume,        kB: recB.data.volume,        unit: '兆', better: true  },
    { label: '空売り比率',    kA: recA.data.shortRatio,    kB: recB.data.shortRatio,    unit: '%',  better: false },
    { label: '騰落レシオ',    kA: recA.data.tokoRachi,     kB: recB.data.tokoRachi,     unit: '',   better: null  },
    { label: '信用評価損益率', kA: recA.data.marginPL,     kB: recB.data.marginPL,      unit: '%',  better: null  },
    { label: '海外フロー',    kA: recA.data.foreignFlow,   kB: recB.data.foreignFlow,   unit: '億', better: true  },
  ];

  let html = `
    <div class="comp-score-row">
      <div class="comp-score-box">
        <div class="comp-date-label">${fmtDate(recA.date)}</div>
        <div class="comp-score-num ${jA.colorClass}">${recA.score}</div>
        <div class="comp-judgment-label ${jA.colorClass}">${jA.label}</div>
      </div>
      <div class="comp-delta-box">
        <div class="comp-delta-label">差分</div>
        <div class="comp-delta-num ${deltaClass}">${deltaStr}</div>
      </div>
      <div class="comp-score-box">
        <div class="comp-date-label">${fmtDate(recB.date)}</div>
        <div class="comp-score-num ${jB.colorClass}">${recB.score}</div>
        <div class="comp-judgment-label ${jB.colorClass}">${jB.label}</div>
      </div>
    </div>
    <div class="comparison-table-scroll">
      <table class="comparison-table">
        <thead>
          <tr>
            <th>指標</th>
            <th>${fmtDate(recA.date)}</th>
            <th class="ct-center">変化</th>
            <th>${fmtDate(recB.date)}</th>
          </tr>
        </thead>
        <tbody>
  `;

  for (const m of METRICS) {
    const vA = m.kA, vB = m.kB;
    const valid = vA != null && vB != null && !isNaN(vA) && !isNaN(vB);
    let diffHtml = '<span class="diff-zero">--</span>';
    if (valid) {
      const diff = vB - vA;
      const sign = diff > 0 ? '+' : '';
      const digits = Number.isInteger(vA) && Number.isInteger(vB) ? 0 : 2;
      const diffStr = `${sign}${diff.toFixed(digits)}${m.unit}`;
      let cls = 'diff-zero';
      if (diff !== 0 && m.better !== null) {
        cls = (m.better ? diff > 0 : diff < 0) ? 'diff-pos' : 'diff-neg';
      }
      diffHtml = `<span class="${cls}">${diffStr}</span>`;
    }
    const dispA = vA != null ? `${vA}${m.unit}` : '--';
    const dispB = vB != null ? `${vB}${m.unit}` : '--';
    html += `
      <tr>
        <td class="ct-metric">${m.label}</td>
        <td>${dispA}</td>
        <td class="ct-center">${diffHtml}</td>
        <td>${dispB}</td>
      </tr>
    `;
  }

  html += '</tbody></table></div>';
  body.innerHTML = html;
}

// ===========================
// スコア推移チャート（Canvas）
// ===========================

function renderScoreChart() {
  const history = loadHistory();
  const wrapEl  = document.getElementById('chart-wrap');
  const canvas  = document.getElementById('score-chart');
  if (!wrapEl || !canvas) return;

  if (history.length < 2) {
    wrapEl.style.display = 'none';
    return;
  }
  wrapEl.style.display = 'block';

  const pts = [...history].reverse();
  const dpr = window.devicePixelRatio || 1;
  const W   = canvas.offsetWidth || 700;
  const H   = 130;

  canvas.width  = W * dpr;
  canvas.height = H * dpr;
  canvas.style.width  = W + 'px';
  canvas.style.height = H + 'px';

  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);

  const PAD_L = 36, PAD_R = 16, PAD_T = 12, PAD_B = 26;
  const PW = W - PAD_L - PAD_R;
  const PH = H - PAD_T - PAD_B;

  ctx.fillStyle = '#0f0f1c';
  ctx.fillRect(0, 0, W, H);

  ctx.lineWidth = 0.5;
  [0, 20, 40, 60, 80, 100].forEach(v => {
    const y = PAD_T + PH - (v / 100) * PH;
    ctx.strokeStyle = v === 40 || v === 60 ? '#3a3a50' : '#1e1e32';
    ctx.beginPath(); ctx.moveTo(PAD_L, y); ctx.lineTo(PAD_L + PW, y); ctx.stroke();
    ctx.fillStyle = '#48486a';
    ctx.font = '9px monospace';
    ctx.textAlign = 'right';
    ctx.fillText(v, PAD_L - 4, y + 3);
  });

  const getX = i  => PAD_L + (pts.length > 1 ? (i / (pts.length - 1)) * PW : PW / 2);
  const getY = sc => PAD_T + PH - (Math.max(0, Math.min(100, sc)) / 100) * PH;

  const scoreColor = sc => {
    if (sc >= 80) return '#22c55e';
    if (sc >= 60) return '#4ade80';
    if (sc >= 40) return '#eab308';
    if (sc >= 20) return '#f97316';
    return '#ef4444';
  };

  // グラデーション面塗り
  const grad = ctx.createLinearGradient(0, PAD_T, 0, PAD_T + PH);
  grad.addColorStop(0, 'rgba(99, 102, 241, 0.2)');
  grad.addColorStop(1, 'rgba(99, 102, 241, 0)');
  ctx.beginPath();
  ctx.moveTo(getX(0), getY(pts[0].score));
  for (let i = 1; i < pts.length; i++) ctx.lineTo(getX(i), getY(pts[i].score));
  ctx.lineTo(getX(pts.length - 1), PAD_T + PH);
  ctx.lineTo(getX(0), PAD_T + PH);
  ctx.closePath();
  ctx.fillStyle = grad;
  ctx.fill();

  // 折れ線
  ctx.beginPath();
  ctx.strokeStyle = '#6366f1';
  ctx.lineWidth = 2;
  ctx.lineJoin = 'round';
  ctx.moveTo(getX(0), getY(pts[0].score));
  for (let i = 1; i < pts.length; i++) ctx.lineTo(getX(i), getY(pts[i].score));
  ctx.stroke();

  // データ点
  pts.forEach((p, i) => {
    const x = getX(i), y = getY(p.score);
    ctx.beginPath();
    ctx.arc(x, y, 4, 0, Math.PI * 2);
    ctx.fillStyle = scoreColor(p.score);
    ctx.fill();
    if (i === pts.length - 1) {
      ctx.beginPath();
      ctx.arc(x, y, 6, 0, Math.PI * 2);
      ctx.strokeStyle = scoreColor(p.score);
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }
  });

  // X軸ラベル
  const maxLabels = Math.min(pts.length, 10);
  const step = Math.max(1, Math.floor(pts.length / maxLabels));
  ctx.fillStyle = '#48486a';
  ctx.font = '9px monospace';
  ctx.textAlign = 'center';
  for (let i = 0; i < pts.length; i += step) {
    const d = new Date(pts[i].date);
    ctx.fillText(`${d.getMonth() + 1}/${d.getDate()}`, getX(i), H - PAD_B + 14);
  }
}

// ===========================
// 初期化
// ===========================

document.addEventListener('DOMContentLoaded', () => {
  // 日付表示
  updateDate();
  setInterval(updateDate, 60000);

  // ヘルプボタン初期化
  initHelpButtons();

  // ===========================
  // ヘルパー — スクロール・ハイライト・ステップ
  // ===========================

  /** ヘッダー高さを考慮したスムーズスクロール */
  function scrollToEl(el, extraOffset) {
    if (!el) return;
    const hh = document.querySelector('.app-header')?.offsetHeight || 60;
    const gap = typeof extraOffset === 'number' ? extraOffset : 16;
    const top = el.getBoundingClientRect().top + window.scrollY - hh - gap;
    window.scrollTo({ top: Math.max(0, top), behavior: 'smooth' });
  }

  /** 要素を一時的にハイライト（CSSアニメーションクラスを着脱） */
  function flashEl(el, cls, duration) {
    if (!el) return;
    const c = cls      || 'section-highlight';
    const d = duration || 900;
    el.classList.remove(c);
    void el.offsetWidth; // reflow
    el.classList.add(c);
    setTimeout(() => el.classList.remove(c), d);
  }

  /** ヒーロー3ステップの現在フェーズを反映 */
  function setStepPhase(phase) {
    document.querySelectorAll('.hero-step[data-step]').forEach(el => {
      el.classList.remove('step-active', 'step-done');
    });
    if (phase === 'input') {
      document.querySelector('.hero-step[data-step="1"]')?.classList.add('step-active');
    } else if (phase === 'done') {
      document.querySelector('.hero-step[data-step="1"]')?.classList.add('step-done');
      document.querySelector('.hero-step[data-step="2"]')?.classList.add('step-done');
      document.querySelector('.hero-step[data-step="3"]')?.classList.add('step-active');
    }
  }

  // アンカーリンクのスムーズスクロール（ヘッダー高さ考慮）
  document.querySelectorAll('a[href^="#"]').forEach(link => {
    link.addEventListener('click', e => {
      const target = document.querySelector(link.getAttribute('href'));
      if (target) { e.preventDefault(); scrollToEl(target); }
    });
  });

  // ===========================
  // ヘッダーCTA — 4状態切替機
  // 状態1 goto-form   : hero/top付近       → 「入力欄へ移動」（nav・アウトライン）
  // 状態2 judge       : input付近          → 「判定を実行」  （exec・グリーン）
  // 状態3 see-history : 判定済み・result付近 → 「履歴を見る」  （confirm・中間パープル）
  // 状態4 back-to-input: history付近       → 「再判定する」  （nav・アウトライン）
  // ===========================
  const secVis = { hero: true, input: false, result: false, history: false };
  let hasJudged = false;

  function updateHeaderCta() {
    const btn = document.getElementById('header-cta');
    if (!btn) return;

    // 優先度: history > (result && judged) > input > その他
    let state;
    if      (secVis.history)                  state = 'back-to-input';
    else if (secVis.result && hasJudged)      state = 'see-history';
    else if (secVis.input)                    state = 'judge';
    else                                      state = 'goto-form';

    btn.dataset.action = state;
    btn.classList.remove('cta-exec', 'cta-confirm');

    switch (state) {
      case 'goto-form':     btn.textContent = '入力欄へ移動'; break;
      case 'judge':         btn.textContent = '判定を実行';  btn.classList.add('cta-exec');    break;
      case 'see-history':   btn.textContent = '履歴を見る';  btn.classList.add('cta-confirm'); break;
      case 'back-to-input': btn.textContent = '再判定する';  break;
    }
  }

  // 4セクションを IntersectionObserver で監視
  if ('IntersectionObserver' in window) {
    const sectionObs = new IntersectionObserver(entries => {
      entries.forEach(e => {
        const el = e.target;
        if      (el.classList.contains('hero-section'))  secVis.hero    = e.isIntersecting;
        else if (el.id === 'input-section')              secVis.input   = e.isIntersecting;
        else if (el.id === 'result-panel-anchor')        secVis.result  = e.isIntersecting;
        else if (el.id === 'history-section')            secVis.history = e.isIntersecting;
        updateHeaderCta();
      });
    }, { threshold: 0.08 });

    [
      document.querySelector('.hero-section'),
      document.getElementById('input-section'),
      document.getElementById('result-panel-anchor'),
      document.getElementById('history-section'),
    ].forEach(el => el && sectionObs.observe(el));
  }

  // ヘッダーCTA クリック — 状態ごとの挙動 + 体験フィードバック
  const headerCta = document.getElementById('header-cta');
  if (headerCta) {
    headerCta.addEventListener('click', () => {
      const action = headerCta.dataset.action;

      // ── 移動系（goto-form / back-to-input）──────────────────
      if (action === 'goto-form' || action === 'back-to-input') {
        const target = document.getElementById('input-section');
        scrollToEl(target);
        setTimeout(() => {
          flashEl(target, 'section-highlight');
          target?.querySelector('input[type="number"]')?.focus({ preventScroll: true });
        }, 520);

      // ── 実行系（judge）— ローディング付き ───────────────────
      } else if (action === 'judge') {
        headerCta.textContent = '判定中...';
        headerCta.classList.add('cta-exec');
        headerCta.disabled = true;

        // 1フレーム後に処理（"判定中..."を画面に描画してから実行）
        requestAnimationFrame(() => requestAnimationFrame(() => {
          runJudgment(true);
          hasJudged = true;
          setStepPhase('done');
          headerCta.disabled = false;
          updateHeaderCta();

          if (window.innerWidth < 900) {
            // モバイル: 結果は上部にある（order: -1）
            setTimeout(() => window.scrollTo({ top: 0, behavior: 'smooth' }), 80);
          } else {
            // デスクトップ: 結果カードを強調
            const resultCard = document.getElementById('result-card');
            setTimeout(() => flashEl(resultCard, 'result-highlight', 1200), 160);
          }
        }));

      // ── 確認系（see-history）────────────────────────────────
      } else if (action === 'see-history') {
        const target = document.getElementById('history-section');
        scrollToEl(target);
        setTimeout(() => {
          flashEl(target, 'section-highlight');
          const latestCard = document.querySelector('#history-tbody .hist-card');
          if (latestCard) flashEl(latestCard, 'history-highlight', 1000);
        }, 520);
      }
    });
  }

  // 判定・リセットボタン（PC）
  const btnJudge = document.getElementById('btn-judge');
  if (btnJudge) btnJudge.addEventListener('click', () => {
    runJudgment(true);
    hasJudged = true;
    setStepPhase('done');
    updateHeaderCta();
    if (window.innerWidth < 900) {
      setTimeout(() => window.scrollTo({ top: 0, behavior: 'smooth' }), 80);
    }
  });
  const btnReset = document.getElementById('btn-reset');
  if (btnReset) btnReset.addEventListener('click', () => {
    resetForm();
    hasJudged = false;
    setStepPhase('input');
    updateHeaderCta();
  });

  // 判定・リセットボタン（スマホ）
  const btnJudgeMobile = document.getElementById('btn-judge-mobile');
  if (btnJudgeMobile) btnJudgeMobile.addEventListener('click', () => {
    runJudgment(true);
    hasJudged = true;
    setStepPhase('done');
    updateHeaderCta();
    setTimeout(() => window.scrollTo({ top: 0, behavior: 'smooth' }), 80);
  });
  const btnResetMobile = document.getElementById('btn-reset-mobile');
  if (btnResetMobile) btnResetMobile.addEventListener('click', () => {
    resetForm();
    hasJudged = false;
    setStepPhase('input');
    updateHeaderCta();
  });

  // 履歴ボタン
  const btnCompare = document.getElementById('btn-compare');
  if (btnCompare) btnCompare.addEventListener('click', showComparison);

  const btnClear = document.getElementById('btn-clear-history');
  if (btnClear) {
    btnClear.addEventListener('click', () => {
      if (!confirm('履歴を全件削除しますか？この操作は取り消せません。')) return;
      localStorage.removeItem(HISTORY_KEY);
      renderHistoryTable();
      renderScoreChart();
      const panel = document.getElementById('comparison-panel');
      if (panel) panel.style.display = 'none';
    });
  }

  const btnCloseComp = document.getElementById('btn-close-comparison');
  if (btnCloseComp) {
    btnCloseComp.addEventListener('click', () => {
      const panel = document.getElementById('comparison-panel');
      if (panel) panel.style.display = 'none';
    });
  }

  // 初期データのロードと判定
  const savedData = loadFromStorage();
  if (savedData) {
    setFormData(savedData);
  } else {
    setFormData(SAMPLE_VALUES);
  }
  runJudgment(false);

  // 履歴テーブル・チャートの初期描画
  renderHistoryTable();
  renderScoreChart();

  window.addEventListener('resize', renderScoreChart);
});
