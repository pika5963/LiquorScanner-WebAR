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
const holoRing = document.getElementById('holo-ring');

// カード内の要素
const detectedNameEl = document.getElementById('detected-name');
const detectedConfidenceEl = document.getElementById('detected-confidence');
const cardMatchMethodEl = document.getElementById('card-match-method');
const webLinksContainer = document.getElementById('web-links');
const cardImageContainer = document.getElementById('card-image-container');
const detectedImg = document.getElementById('detected-img');

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
            type: "TEXT_DETECTION"
          },
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
  
  // 3D演出を初期化
  if (holoRing) {
    holoRing.setAttribute('visible', 'false');
    holoRing.setAttribute('scale', '0 0 0');
  }

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
 * テキストを1文字ずつタイピング表示する演出
 */
function typeWriter(element, text, speed = 35) {
  element.textContent = "";
  let i = 0;
  
  if (element.typingInterval) {
    clearInterval(element.typingInterval);
  }
  
  element.typingInterval = setInterval(() => {
    if (i < text.length) {
      element.textContent += text.charAt(i);
      i++;
    } else {
      clearInterval(element.typingInterval);
      element.typingInterval = null;
    }
  }, speed);
}

/**
 * Google Cloud Vision APIのレスポンス結果をパースしてARカードに展開
 */
function parseAndDisplayResults(apiResponse, scanIndex) {
  const annotations = apiResponse.responses?.[0];
  const textAnnotations = annotations?.textAnnotations || [];
  const webDetection = annotations?.webDetection;

  let detectedName = "";
  let confidenceScore = 0;
  let isOcrMatch = false;

  // 1. 文字検出結果 (TEXT_DETECTION) を最優先で評価 (Pythonistaの挙動)
  if (textAnnotations.length > 0 && textAnnotations[0].description) {
    const rawText = textAnnotations[0].description;
    // 改行文字をスペースに置き換え、前後の不要な空白をトリミング
    detectedName = rawText.replace(/\n/g, ' ').trim();
    
    // 長すぎる文字列は最初の40文字にカットしてプレビューを保護
    if (detectedName.length > 40) {
      detectedName = detectedName.substring(0, 40) + "...";
    }
    
    // テキスト検出成功時は高い基準確信度を設定
    confidenceScore = 95.0;
    isOcrMatch = true;
  }

  // 2. 文字が検出されなかった場合のみウェブ検出 (WEB_DETECTION) で推測
  if (!detectedName && webDetection) {
    if (webDetection.bestGuessLabels && webDetection.bestGuessLabels.length > 0) {
      detectedName = webDetection.bestGuessLabels[0].label;
    }

    const entities = webDetection.webEntities || [];
    
    if (!detectedName && entities.length > 0) {
      detectedName = entities[0].description;
    }

    // ウェブ検出スコアから確信度を算出
    if (entities.length > 0) {
      const matchedEntity = entities.find(e => e.description && e.description.toLowerCase() === detectedName.toLowerCase()) || entities[0];
      confidenceScore = matchedEntity.score ? Math.min(Math.round(matchedEntity.score * 100), 99.9) : 85.0;
    } else {
      confidenceScore = 75.0;
    }
  }

  // 3. どちらのモードでも名前が特定できなかった場合
  if (!detectedName) {
    displayFailure("対象物を識別できませんでした");
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

  // ARカードのデータ設定 (タイピング演出を適用)
  typeWriter(detectedNameEl, detectedName, 35);
  detectedConfidenceEl.textContent = `${confidenceScore.toFixed(2)}%`;
  
  // 解析方式 (Match Method) の設定とカラー指定
  if (cardMatchMethodEl) {
    if (isOcrMatch) {
      cardMatchMethodEl.textContent = "TEXT OCR";
      cardMatchMethodEl.style.color = "var(--neon-blue)";
    } else {
      cardMatchMethodEl.textContent = "VISUAL AI";
      cardMatchMethodEl.style.color = "var(--neon-green)";
    }
  }

  // 類似画像およびWeb参照ページのデータ取得
  const similarImages = webDetection.visuallySimilarImages || [];
  
  // 切り替え用のアセットリストを作成
  const toggleAssets = [];
  similarImages.forEach((img, idx) => {
    if (idx < 3 && img.url) {
      // 類似の度合いに応じて確信度（%）を減衰させて算出
      let score = confidenceScore;
      if (idx === 1) score = Math.max(confidenceScore - 6.5, 45.0);
      if (idx === 2) score = Math.max(confidenceScore - 14.2, 30.0);
      
      toggleAssets.push({
        url: img.url,
        confidence: score,
        title: `Visually Similar Image Source ${idx + 1}`
      });
    }
  });

  // A-Frame 3Dホログラフィック演出のアクティベート
  if (holoRing) {
    holoRing.setAttribute('visible', 'true');
    holoRing.setAttribute('animation__scale', 'property: scale; from: 0 0 0; to: 1 1 1; dur: 800; easing: easeOutElastic');
  }

  // 関連Webリンク/切り替え項目の生成
  webLinksContainer.innerHTML = "";

  if (toggleAssets.length > 0) {
    // 画像切り替えフェード用のイベントハンドラ設定
    detectedImg.onload = () => {
      detectedImg.classList.remove('fade-out');
    };
    detectedImg.onerror = () => {
      cardImageContainer.style.display = 'none';
      detectedImg.src = "";
    };

    toggleAssets.forEach((asset, idx) => {
      const row = document.createElement('div');
      row.className = "web-link-row";
      
      // テキストボタン (タップで画像と確信度の切り替え、ページ遷移なし)
      const btn = document.createElement('button');
      btn.className = "web-link-btn";
      if (idx === 0) btn.classList.add('active');
      btn.textContent = asset.title;
      btn.type = "button";
      
      btn.addEventListener('click', () => {
        // すべてのボタンのアクティブクラスを除去
        const allBtns = webLinksContainer.querySelectorAll('.web-link-btn');
        allBtns.forEach(b => b.classList.remove('active'));
        
        // 選択されたボタンをアクティブにする
        btn.classList.add('active');
        
        // フェードアウト効果を挟んで画像と数値を切り替え
        detectedImg.classList.add('fade-out');
        setTimeout(() => {
          detectedImg.src = asset.url;
          detectedConfidenceEl.textContent = `${asset.confidence.toFixed(2)}%`;
          cardImageContainer.style.display = 'block'; // エラーハンドリングで消えた場合のための再表示
        }, 200);
      });
      
      // 外部リンクアイコンリンク (↗タップ時に別ページへ遷移)
      const linkIcon = document.createElement('a');
      linkIcon.href = asset.url;
      linkIcon.target = "_blank";
      linkIcon.rel = "noopener noreferrer";
      linkIcon.className = "web-link-icon-btn";
      linkIcon.textContent = "↗";
      linkIcon.title = "画像を新しいタブで開く";
      
      row.appendChild(btn);
      row.appendChild(linkIcon);
      webLinksContainer.appendChild(row);
    });

    // 初期表示設定 (1枚目を表示)
    detectedImg.src = toggleAssets[0].url;
    cardImageContainer.style.display = 'block';
    detectedConfidenceEl.textContent = `${toggleAssets[0].confidence.toFixed(2)}%`;
  } else {
    // 類似画像が見つからなかった場合のフォールバック (Google検索リンクを表示)
    cardImageContainer.style.display = 'none';
    detectedImg.src = "";
    detectedConfidenceEl.textContent = `${confidenceScore.toFixed(2)}%`;

    const searchUrl = `https://www.google.com/search?q=${encodeURIComponent(detectedName)}`;
    const row = document.createElement('div');
    row.className = "web-link-row";
    
    const btn = document.createElement('button');
    btn.className = "web-link-btn active";
    btn.textContent = `Search on Google: "${detectedName}"`;
    btn.type = "button";
    
    const linkIcon = document.createElement('a');
    linkIcon.href = searchUrl;
    linkIcon.target = "_blank";
    linkIcon.rel = "noopener noreferrer";
    linkIcon.className = "web-link-icon-btn";
    linkIcon.textContent = "↗";
    
    row.appendChild(btn);
    row.appendChild(linkIcon);
    webLinksContainer.appendChild(row);
  }

  // カードをスライドイン
  openArCard();
}

/**
 * 識別失敗時の表示
 */
function displayFailure(message) {
  typeWriter(detectedNameEl, message, 35);
  detectedConfidenceEl.textContent = "0.00%";
  
  if (cardMatchMethodEl) {
    cardMatchMethodEl.textContent = "FAILED";
    cardMatchMethodEl.style.color = "var(--neon-red)";
  }
  
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
  
  // 3Dホログラフィック演出のフェードアウト
  if (holoRing) {
    holoRing.setAttribute('animation__scale', 'property: scale; from: 1 1 1; to: 0 0 0; dur: 400; easing: easeInBack');
    setTimeout(() => {
      holoRing.setAttribute('visible', 'false');
    }, 400);
  }

  // 類似画像のクリア
  if (detectedImg) {
    detectedImg.src = "";
  }
  if (cardImageContainer) {
    cardImageContainer.style.display = 'none';
  }
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
