/**
 * 🚀 WebARオンデマンド型お酒識別アプリ - script.js
 * 
 * シニアフルスタックエンジニアリング基準:
 * - 堅牢なカメラ起動フォールバック
 * - 物理的なローカルセーフガード (1日30回通信制限)
 * - Canvasフレーム切り出し & Google Cloud Vision API (Web Detection) 連携
 * - サイバーパンクUIアニメーション連動
 * - PWA Service Worker 登録
 */

// ==========================================
// 1. 認証設定 (APIキー方式)
// ==========================================
const API_KEY = "YOUR_API_KEY_HERE";

// ローカルストレージに設定されたAPIキーを優先的に読み込む (検証や一時的なキー変更に対応するため)
let currentApiKey = localStorage.getItem('vision_api_key') || API_KEY;

// ==========================================
// 2. DOM要素の取得
// ==========================================
const videoElement = document.getElementById('camera-stream');
const canvasElement = document.getElementById('capture-canvas');
const shutterButton = document.getElementById('shutter-button');
const loadingRing = document.getElementById('btn-loading-ring');
const scannerHud = document.getElementById('scanner-hud');
const arCard = document.getElementById('ar-card');
const cardCloseBtn = document.getElementById('card-close');
const scanCountVal = document.getElementById('scan-count-val');

// カード内の要素
const detectedNameEl = document.getElementById('detected-name');
const detectedConfidenceEl = document.getElementById('detected-confidence');
const cardScanIndexEl = document.getElementById('card-scan-index');
const webLinksContainer = document.getElementById('web-links');

// モーダル要素
const warningModal = document.getElementById('warning-modal');
const warningCloseBtn = document.getElementById('warning-close-btn');
const apiModal = document.getElementById('api-modal');
const apiSetupTrigger = document.getElementById('api-setup-trigger');
const apiKeyInput = document.getElementById('api-key-input');
const apiSaveBtn = document.getElementById('api-save-btn');
const apiCancelBtn = document.getElementById('api-cancel-btn');

// ==========================================
// 3. ローカルセーフガード (1日30回制限)
// ==========================================
const LIMIT_MAX = 30;

/**
 * 今日の日付文字列を取得 (YYYY-MM-DD)
 */
function getTodayString() {
  const d = new Date();
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const date = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${date}`;
}

/**
 * カウンターの状態をチェック・更新する
 */
function checkSafeguard() {
  const today = getTodayString();
  const lastScanDate = localStorage.getItem('ls_last_scan_date');
  let currentCount = parseInt(localStorage.getItem('ls_scan_count') || '0', 10);

  // 日付が変わっている場合はカウンターを自動リセット
  if (lastScanDate !== today) {
    currentCount = 0;
    localStorage.setItem('ls_scan_count', '0');
    localStorage.setItem('ls_last_scan_date', today);
  }

  // UI上のカウンター表示を更新
  scanCountVal.textContent = currentCount;

  // 上限に達している場合は赤文字警告スタイルを適用
  if (currentCount >= LIMIT_MAX) {
    scanCountVal.classList.add('warning');
    return false; // 上限突破
  } else {
    scanCountVal.classList.remove('warning');
    return true; // 制限内
  }
}

/**
 * スキャン実行時にカウンターを1増やす
 */
function incrementSafeguardCount() {
  const currentCount = parseInt(localStorage.getItem('ls_scan_count') || '0', 10);
  const nextCount = currentCount + 1;
  localStorage.setItem('ls_scan_count', nextCount.toString());
  scanCountVal.textContent = nextCount;
  
  if (nextCount >= LIMIT_MAX) {
    scanCountVal.classList.add('warning');
  }
  return nextCount;
}

// ==========================================
// 4. WebRTC 背面カメラ制御
// ==========================================
let mediaStream = null;

async function startCamera() {
  // すでにストリームが起動している場合は停止する
  if (mediaStream) {
    mediaStream.getTracks().forEach(track => track.stop());
  }

  const constraintsList = [
    // 1. 背面カメラ優先（解像度フルHD〜HDを要求）
    {
      video: {
        facingMode: { ideal: "environment" },
        width: { ideal: 1920 },
        height: { ideal: 1080 }
      },
      audio: false
    },
    // 2. iOSの一部環境向けフォールバック
    {
      video: {
        facingMode: "environment"
      },
      audio: false
    },
    // 3. 最終的なデフォルトビデオ
    {
      video: true,
      audio: false
    }
  ];

  for (let i = 0; i < constraintsList.length; i++) {
    try {
      mediaStream = await navigator.mediaDevices.getUserMedia(constraintsList[i]);
      videoElement.srcObject = mediaStream;
      
      // iOS Safariでの自動再生を確実にするためのプロパティ設定
      videoElement.setAttribute('playsinline', true);
      videoElement.setAttribute('autoplay', true);
      videoElement.setAttribute('muted', true);
      
      // プレイ開始待ち
      await new Promise((resolve) => {
        videoElement.onloadedmetadata = () => {
          videoElement.play().then(resolve);
        };
      });
      
      console.log('Camera started successfully with constraints index:', i);
      break; // 成功したらループを抜ける
    } catch (err) {
      console.warn(`Camera constraint index ${i} failed:`, err);
      if (i === constraintsList.length - 1) {
        alert('カメラの起動に失敗しました。カメラへのアクセス権限を許可してください。');
      }
    }
  }
}

// ==========================================
// 5. Canvas 画像切り出し (Base64 JPEG変換)
// ==========================================
function captureFrame() {
  const width = videoElement.videoWidth;
  const height = videoElement.videoHeight;
  
  if (width === 0 || height === 0) {
    console.error('Video resolution not ready.');
    return null;
  }

  canvasElement.width = width;
  canvasElement.height = height;

  const context = canvasElement.getContext('2d');
  
  // ビデオプレビューをCanvasに描画
  context.drawImage(videoElement, 0, 0, width, height);

  // 1フレームを画質85%のJPEG Base64に変換
  const dataUrl = canvasElement.toDataURL('image/jpeg', 0.85);
  
  // API送信用にプレフィックス「data:image/jpeg;base64,」を除外した文字列を取得
  return dataUrl.split(',')[1];
}

// ==========================================
// 6. Cloud Vision API 通信 (Web Detection)
// ==========================================
async function sendScanToVisionAPI(base64Image) {
  if (currentApiKey === "YOUR_API_KEY_HERE" || !currentApiKey) {
    showApiModal();
    throw new Error("APIキーが設定されていません。UI上の⚙️アイコンから設定してください。");
  }

  const endpoint = `https://vision.googleapis.com/v1/images:annotate?key=${currentApiKey}`;
  
  const requestBody = {
    requests: [
      {
        image: {
          content: base64Image
        },
        features: [
          {
            type: "WEB_DETECTION",
            maxResults: 8
          }
        ]
      }
    ]
  };

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(requestBody)
  });

  if (!response.ok) {
    const errorData = await response.json();
    throw new Error(errorData.error?.message || `API通信エラー (Status: ${response.status})`);
  }

  return await response.json();
}

// ==========================================
// 7. UI制御と演出
// ==========================================

/**
 * スキャン処理全体の実行コントローラー
 */
async function executeScan() {
  // 1. ローカルセーフガードの確認
  if (!checkSafeguard()) {
    showWarningModal();
    return;
  }

  // 2. UIをスキャン中状態へ移行
  setScanningState(true);
  closeArCard();

  try {
    // 3. Canvasから画像フレームの切り出し
    const base64Image = captureFrame();
    if (!base64Image) {
      throw new Error("カメラフレームのキャプチャに失敗しました。");
    }

    // 4. API通信の実行
    const result = await sendScanToVisionAPI(base64Image);
    
    // 5. ローカルセーフガードのカウンターを加算
    const scanIndex = incrementSafeguardCount();

    // 6. 結果解析とカード表示
    parseAndDisplayResults(result, scanIndex);

  } catch (error) {
    console.error('Scan Execution Error:', error);
    alert(`エラーが発生しました: ${error.message}`);
  } finally {
    // 7. UI状態を元に戻す
    setScanningState(false);
  }
}

/**
 * UIの読み込み状態アニメーション適用
 */
function setScanningState(isScanning) {
  if (isScanning) {
    shutterButton.disabled = true;
    loadingRing.classList.add('active');
    scannerHud.classList.add('scanning');
  } else {
    shutterButton.disabled = false;
    loadingRing.classList.remove('active');
    scannerHud.classList.remove('scanning');
  }
}

/**
 * Google Cloud Vision APIのレスポンス結果をパースしてARカードに展開
 */
function parseAndDisplayResults(apiResponse, scanIndex) {
  const annotations = apiResponse.responses?.[0];
  const webDetection = annotations?.webDetection;

  // データが何も取得できなかった場合
  if (!webDetection || (!webDetection.webEntities && !webDetection.bestGuessLabels)) {
    displayFailure("対象物を識別できませんでした");
    return;
  }

  // 最も確率の高い名前を決定
  // 1. 検出された最良推測ラベルを最優先
  // 2. なければWebエンティティの先頭のdescriptionを取得
  let detectedName = "";
  let confidenceScore = 0;

  if (webDetection.bestGuessLabels && webDetection.bestGuessLabels.length > 0) {
    detectedName = webDetection.bestGuessLabels[0].label;
  }

  // Webエンティティのリストをパースして類似リンクやより詳細な名前を補完
  const entities = webDetection.webEntities || [];
  
  if (!detectedName && entities.length > 0) {
    detectedName = entities[0].description;
  }

  // 確信度の算出 (Webエンティティのscoreを利用)
  if (entities.length > 0) {
    const matchedEntity = entities.find(e => e.description && e.description.toLowerCase() === detectedName.toLowerCase()) || entities[0];
    // WebDetectionのスコアは確信度とは定義が異なりますが、デザイン上100%基準の数値として近似表現します
    confidenceScore = matchedEntity.score ? Math.min(Math.round(matchedEntity.score * 100), 99.9) : 85.0;
  } else {
    confidenceScore = 75.0; // bestGuessLabelのみの場合のフォールバック
  }

  if (!detectedName) {
    displayFailure("対象物の名称を特定できませんでした");
    return;
  }

  // 音声ファイルの再生演出 (将来の拡張用プレースホルダー)
  console.log("🎵 音声再生プレースホルダー: assets/success.mp3 (実装時はコメントを解除して配置)");
  /*
  try {
    const audio = new Audio('assets/success.mp3');
    audio.play().catch(e => console.log("Audio playback blocked by browser policies. Need user interaction first."));
  } catch (e) {
    console.error("Audio playback error:", e);
  }
  */

  // ARカードのデータ設定
  detectedNameEl.textContent = detectedName;
  detectedConfidenceEl.textContent = `${confidenceScore.toFixed(2)}%`;
  cardScanIndexEl.textContent = `#${String(scanIndex).padStart(2, '0')}`;

  // 関連Webリンクの生成
  webLinksContainer.innerHTML = "";
  const maxLinks = 3;
  let linksAdded = 0;

  // 類似画像やソースURLから関連リンクを生成
  const webPages = webDetection.pagesWithMatchingImages || [];
  const similarImages = webDetection.visuallySimilarImages || [];

  const combinedLinks = [
    ...webPages.map(p => ({ url: p.url, title: p.pageTitle || 'Matching Source Page' })),
    ...similarImages.map(img => ({ url: img.url, title: 'Visually Similar Image Source' }))
  ];

  if (combinedLinks.length > 0) {
    combinedLinks.forEach(link => {
      if (linksAdded < maxLinks && link.url) {
        const a = document.createElement('a');
        a.href = link.url;
        a.target = "_blank";
        a.rel = "noopener noreferrer";
        a.className = "web-link";
        a.textContent = link.title;
        webLinksContainer.appendChild(a);
        linksAdded++;
      }
    });
  } else {
    // リンクがない場合は検索用のGoogle検索URLを代わりに提供
    const searchUrl = `https://www.google.com/search?q=${encodeURIComponent(detectedName)}`;
    const a = document.createElement('a');
    a.href = searchUrl;
    a.target = "_blank";
    a.rel = "noopener noreferrer";
    a.className = "web-link";
    a.textContent = `Search on Google: "${detectedName}"`;
    webLinksContainer.appendChild(a);
  }

  // カードをスライドイン
  openArCard();
}

/**
 * 識別失敗時の表示
 */
function displayFailure(message) {
  detectedNameEl.textContent = message;
  detectedConfidenceEl.textContent = "0.00%";
  webLinksContainer.innerHTML = `<span style="color: var(--text-secondary); font-size: 0.8rem;">結果が見つかりませんでした。別の角度からお試しください。</span>`;
  openArCard();
}

/**
 * ARカード操作
 */
function openArCard() {
  arCard.classList.add('active');
}

function closeArCard() {
  arCard.classList.remove('active');
}

/**
 * ローカルセーフガード制限警告モーダル操作
 */
function showWarningModal() {
  warningModal.classList.add('active');
}

function closeWarningModal() {
  warningModal.classList.remove('active');
}

/**
 * APIキー設定モーダル操作
 */
function showApiModal() {
  apiKeyInput.value = currentApiKey === "YOUR_API_KEY_HERE" ? "" : currentApiKey;
  apiModal.classList.add('active');
}

function closeApiModal() {
  apiModal.classList.remove('active');
}

function saveApiKey() {
  const newKey = apiKeyInput.value.trim();
  if (newKey) {
    currentApiKey = newKey;
    localStorage.setItem('vision_api_key', newKey);
    alert('APIキーを一時保存しました。(ブラウザのキャッシュ内に保存されます)');
  } else {
    currentApiKey = API_KEY;
    localStorage.removeItem('vision_api_key');
    alert('デフォルトのAPIキー設定に戻しました。');
  }
  closeApiModal();
}

// ==========================================
// 8. イベントリスナーの登録 & 初期化
// ==========================================
window.addEventListener('DOMContentLoaded', () => {
  // 初期チェック
  checkSafeguard();
  
  // カメラの初期起動
  startCamera();

  // スキャン（シャッター）ボタン
  shutterButton.addEventListener('click', executeScan);

  // カード閉じるボタン
  cardCloseBtn.addEventListener('click', closeArCard);

  // 警告モーダル閉じる
  warningCloseBtn.addEventListener('click', closeWarningModal);

  // API設定関連
  apiSetupTrigger.addEventListener('click', showApiModal);
  apiCancelBtn.addEventListener('click', closeApiModal);
  apiSaveBtn.addEventListener('click', saveApiKey);
  
  // モーダル背景クリックでのキャンセル
  apiModal.addEventListener('click', (e) => {
    if (e.target === apiModal) closeApiModal();
  });
  warningModal.addEventListener('click', (e) => {
    if (e.target === warningModal) closeWarningModal();
  });
});

// PWA Service Worker の登録
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js')
      .then((registration) => {
        console.log('ServiceWorker registration successful with scope: ', registration.scope);
      }, (err) => {
        console.log('ServiceWorker registration failed: ', err);
      });
  });
}
