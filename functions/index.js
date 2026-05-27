const crypto = require("crypto");
const admin = require("firebase-admin");
const { onRequest } = require("firebase-functions/v2/https");
const { defineSecret } = require("firebase-functions/params");

admin.initializeApp();

const nicepaySecretKey = defineSecret("NICEPAY_SECRET_KEY");

const REGION = "asia-northeast3";
const PUBLIC_BASE_URL = "https://auto-web-8f2de.web.app";
const NICEPAY_CLIENT_KEY = "R2_b4be71ab9b6d4955882b0fe7e94d0761";
const NICEPAY_API_BASE = "https://api.nicepay.co.kr";

const plans = {
  pro: {
    id: "pro",
    name: "Auto Input Pro",
    amount: 4900,
    licensePlan: "pro",
    months: 1
  },
  business: {
    id: "business",
    name: "Auto Input Business",
    amount: 29000,
    licensePlan: "business",
    months: 1
  }
};

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function getField(data, ...keys) {
  for (const key of keys) {
    if (data[key] !== undefined && data[key] !== null && data[key] !== "") return data[key];
  }
  return "";
}

function parseBody(req) {
  if (req.body && typeof req.body === "object" && !Buffer.isBuffer(req.body)) return req.body;
  const raw = req.rawBody ? req.rawBody.toString("utf8") : "";
  return Object.fromEntries(new URLSearchParams(raw));
}

function addMonths(date, months) {
  const next = new Date(date);
  next.setMonth(next.getMonth() + months);
  return next;
}

function renderPage({ title, body }) {
  return `<!doctype html>
<html lang="ko">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${escapeHtml(title)}</title>
    <style>
      :root { color-scheme: light; font-family: Inter, Pretendard, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
      body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: #f6f7fb; color: #172033; }
      main { width: min(520px, calc(100vw - 32px)); background: white; border: 1px solid #dfe4ef; border-radius: 8px; padding: 32px; box-shadow: 0 20px 50px rgba(23, 32, 51, 0.12); }
      h1 { margin: 0 0 12px; font-size: 26px; line-height: 1.25; }
      p { margin: 0 0 18px; color: #58627a; line-height: 1.7; }
      dl { display: grid; gap: 10px; margin: 24px 0; }
      div.row { display: flex; justify-content: space-between; gap: 16px; padding: 12px 0; border-bottom: 1px solid #edf0f6; }
      dt { color: #727d95; }
      dd { margin: 0; font-weight: 700; text-align: right; }
      button, a.button { width: 100%; box-sizing: border-box; border: 0; border-radius: 8px; padding: 14px 18px; background: #1d3f8f; color: white; font-size: 16px; font-weight: 800; text-decoration: none; cursor: pointer; display: inline-flex; justify-content: center; }
      .muted { font-size: 13px; color: #7b8498; }
    </style>
    <script src="https://pay.nicepay.co.kr/v1/js/"></script>
  </head>
  <body>
    <main>${body}</main>
  </body>
</html>`;
}

exports.checkout = onRequest({ region: REGION, invoker: "public" }, async (req, res) => {
  if (req.method !== "GET") {
    res.status(405).send("Method Not Allowed");
    return;
  }

  const plan = plans[String(req.query.plan || "").toLowerCase()];
  const uid = String(req.query.uid || "").trim();
  const email = String(req.query.email || "").trim();

  if (!plan || !uid) {
    res.status(400).send(renderPage({
      title: "결제 요청 오류",
      body: "<h1>결제를 시작할 수 없습니다</h1><p>플랜 또는 로그인 정보가 없습니다. Auto Input 앱에서 Google 로그인 후 다시 결제해 주세요.</p>"
    }));
    return;
  }

  const orderId = crypto.randomUUID();
  await admin.firestore().collection("paymentOrders").doc(orderId).set({
    orderId,
    uid,
    email,
    plan: plan.id,
    amount: plan.amount,
    status: "pending",
    provider: "nicepay",
    createdAt: admin.firestore.FieldValue.serverTimestamp()
  });

  const returnUrl = `${PUBLIC_BASE_URL}/nicepay-return`;
  const failUrl = `${PUBLIC_BASE_URL}/payment-fail.html`;
  const body = `
    <h1>${escapeHtml(plan.name)} 결제</h1>
    <p>결제 완료 후 Auto Input 앱에서 라이선스 새로고침을 누르면 플랜이 반영됩니다.</p>
    <dl>
      <div class="row"><dt>플랜</dt><dd>${escapeHtml(plan.name)}</dd></div>
      <div class="row"><dt>금액</dt><dd>${plan.amount.toLocaleString("ko-KR")}원</dd></div>
      <div class="row"><dt>계정</dt><dd>${escapeHtml(email || uid)}</dd></div>
    </dl>
    <button id="pay-button" type="button">NicePay로 결제하기</button>
    <p class="muted">결제창이 열리지 않으면 팝업 차단을 해제한 뒤 다시 눌러주세요.</p>
    <script>
      document.getElementById("pay-button").addEventListener("click", function () {
        AUTHNICE.requestPay({
          clientId: ${JSON.stringify(NICEPAY_CLIENT_KEY)},
          method: "card",
          orderId: ${JSON.stringify(orderId)},
          amount: ${JSON.stringify(plan.amount)},
          goodsName: ${JSON.stringify(plan.name)},
          returnUrl: ${JSON.stringify(returnUrl)},
          mallReserved: ${JSON.stringify(JSON.stringify({ uid, plan: plan.id }))},
          buyerEmail: ${JSON.stringify(email)},
          fnError: function (result) {
            location.href = ${JSON.stringify(failUrl)} + "?message=" + encodeURIComponent(result.errorMsg || "결제창을 열 수 없습니다.");
          }
        });
      });
    </script>`;

  res.status(200).send(renderPage({ title: `${plan.name} 결제`, body }));
});

exports.nicepayReturn = onRequest({ region: REGION, invoker: "public", secrets: [nicepaySecretKey] }, async (req, res) => {
  if (req.method !== "POST") {
    res.redirect(`${PUBLIC_BASE_URL}/payment-fail.html?message=${encodeURIComponent("잘못된 결제 응답입니다.")}`);
    return;
  }

  const data = parseBody(req);
  const authResultCode = getField(data, "authResultCode", "AuthResultCode");
  const authResultMsg = getField(data, "authResultMsg", "AuthResultMsg");
  const tid = getField(data, "tid", "Tid", "TxTid");
  const orderId = getField(data, "orderId", "Moid");
  const amount = Number(getField(data, "amount", "Amt"));
  const authToken = getField(data, "authToken", "AuthToken");
  const signature = getField(data, "signature", "Signature");
  const secretKey = nicepaySecretKey.value();

  const orderRef = admin.firestore().collection("paymentOrders").doc(orderId);
  const orderSnap = await orderRef.get();
  const order = orderSnap.exists ? orderSnap.data() : null;

  try {
    if (authResultCode !== "0000") {
      throw new Error(authResultMsg || "NicePay 인증에 실패했습니다.");
    }
    if (!order) throw new Error("결제 주문을 찾을 수 없습니다.");
    if (Number(order.amount) !== amount) throw new Error("결제 금액이 주문 금액과 다릅니다.");
    if (!tid) throw new Error("NicePay 거래번호가 없습니다.");

    if (signature && authToken) {
      const expected = sha256(`${authToken}${NICEPAY_CLIENT_KEY}${amount}${secretKey}`);
      if (signature !== expected) throw new Error("결제 인증 서명 검증에 실패했습니다.");
    }

    const credentials = Buffer.from(`${NICEPAY_CLIENT_KEY}:${secretKey}`).toString("base64");
    const approveResponse = await fetch(`${NICEPAY_API_BASE}/v1/payments/${encodeURIComponent(tid)}`, {
      method: "POST",
      headers: {
        "Accept": "application/json",
        "Authorization": `Basic ${credentials}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ amount })
    });
    const approveResult = await approveResponse.json();

    if (!approveResponse.ok || approveResult.resultCode !== "0000" || approveResult.status !== "paid") {
      throw new Error(approveResult.resultMsg || "NicePay 승인에 실패했습니다.");
    }

    const plan = plans[order.plan];
    const now = new Date();
    const expiresAt = addMonths(now, plan.months);

    await admin.firestore().runTransaction(async (transaction) => {
      transaction.update(orderRef, {
        status: "paid",
        tid,
        nicepay: approveResult,
        paidAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      });
      transaction.set(admin.firestore().collection("licenses").doc(order.uid), {
        plan: plan.licensePlan,
        provider: "nicepay",
        status: "active",
        email: order.email || approveResult.buyerEmail || "",
        orderId,
        tid,
        paidAmount: amount,
        expiresAt: admin.firestore.Timestamp.fromDate(expiresAt),
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      }, { merge: true });
    });

    res.redirect(`${PUBLIC_BASE_URL}/payment-success.html?plan=${encodeURIComponent(plan.id)}`);
  } catch (error) {
    if (orderSnap.exists) {
      await orderRef.set({
        status: "failed",
        failureMessage: error.message,
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      }, { merge: true });
    }
    res.redirect(`${PUBLIC_BASE_URL}/payment-fail.html?message=${encodeURIComponent(error.message)}`);
  }
});
