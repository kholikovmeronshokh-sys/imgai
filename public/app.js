const storageKey = "uzart-lab-client-id";
const clientId = getOrCreateClientId();

const promptInput = document.getElementById("prompt");
const generateButton = document.getElementById("generateButton");
const statusText = document.getElementById("statusText");
const helperText = document.getElementById("helperText");
const remainingCount = document.getElementById("remainingCount");
const limitCopy = document.getElementById("limitCopy");
const placeholder = document.getElementById("placeholder");
const resultImage = document.getElementById("resultImage");
const downloadLink = document.getElementById("downloadLink");

let serverReady = false;
let currentUsage = {
  remaining: 2,
  resetAt: null,
};

boot();
generateButton.addEventListener("click", handleGenerate);

async function boot() {
  renderUsage(currentUsage);

  try {
    const response = await fetch("/api/status");
    const data = await response.json();
    serverReady = Boolean(data.ok);

    if (!data.configured) {
      statusText.textContent = ".env ichida HF_TOKEN hali sozlanmagan.";
      return;
    }

    const usageResponse = await fetch("/api/usage", {
      headers: {
        "x-client-id": clientId,
      },
    });
    const usageData = await usageResponse.json();
    if (usageResponse.ok) {
      currentUsage = {
        remaining: typeof usageData.remaining === "number" ? usageData.remaining : 2,
        resetAt: usageData.resetAt || null,
      };
      renderUsage(currentUsage);
    }

    statusText.textContent = "Server tayyor. Uzbekcha prompt yozishingiz mumkin.";
  } catch (error) {
    statusText.textContent = "Serverga ulanib bo'lmadi.";
  }
}

async function handleGenerate() {
  const prompt = promptInput.value.trim();
  const usage = currentUsage;

  if (!serverReady) {
    statusText.textContent = "Server hali tayyor emas.";
    return;
  }

  if (!prompt) {
    statusText.textContent = "Avval prompt yozing.";
    promptInput.focus();
    return;
  }

  if (usage.remaining <= 0 && Date.now() < usage.resetAt) {
    renderUsage(usage);
    statusText.textContent = "Kunlik limit tugagan. Reset vaqtini kuting.";
    return;
  }

  setLoading(true);
  statusText.textContent = "Rasm yaratilmoqda...";
  helperText.textContent = "Model promptni qayta ishlayapti. Bir oz kuting.";

  try {
    const response = await fetch("/api/generate", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-client-id": clientId,
      },
      body: JSON.stringify({ prompt: buildPrompt(prompt) }),
    });

    const data = await response.json();

    if (!response.ok) {
      if (typeof data.remaining === "number" && data.resetAt) {
        currentUsage = {
          remaining: data.remaining,
          resetAt: data.resetAt,
        };
        renderUsage(currentUsage);
      }

      if (data.reason === "quota_exceeded") {
        helperText.textContent =
          "Bu sayt limiti emas. Hozir HF quota yoki provider cheklovi bor.";
      } else if (data.reason === "auth_error") {
        helperText.textContent =
          "HF token noto'g'ri yoki tanlangan modelga ruxsat yo'q.";
      }

      throw new Error(data.error || "Generatsiya amalga oshmadi");
    }

    const imageUrl = `data:image/png;base64,${data.imageBase64}`;
    resultImage.src = imageUrl;
    resultImage.classList.remove("hidden");
    placeholder.classList.add("hidden");
    downloadLink.href = imageUrl;
    downloadLink.classList.remove("hidden");

    currentUsage = {
      remaining: data.remaining,
      resetAt: data.resetAt,
    };
    renderUsage(currentUsage);

    statusText.textContent = "Rasm tayyor bo'ldi.";
    helperText.textContent =
      data.text || "Agar xohlasangiz, promptni boyitib yana bir variant yaratishingiz mumkin.";
  } catch (error) {
    statusText.textContent = error.message;
    if (helperText.textContent === "Model promptni qayta ishlayapti. Bir oz kuting.") {
      helperText.textContent =
        "Agar prompt juda qisqa bo'lsa, uslub va detal qo'shib qayta urinib ko'ring.";
    }
  } finally {
    setLoading(false);
  }
}

function setLoading(isLoading) {
  generateButton.disabled = isLoading;
  generateButton.textContent = isLoading ? "Yaratilmoqda..." : "Rasm yaratish";
}

function getOrCreateClientId() {
  const existing = localStorage.getItem(storageKey);
  if (existing) {
    return existing;
  }

  const id = self.crypto.randomUUID();
  localStorage.setItem(storageKey, id);
  return id;
}

function renderUsage(usage) {
  if (!usage.resetAt || Date.now() >= usage.resetAt) {
    remainingCount.textContent = "2/2";
    limitCopy.textContent = "Bugun 2 ta generatsiya mavjud.";
    return;
  }

  remainingCount.textContent = `${usage.remaining}/2`;

  if (usage.remaining > 0) {
    limitCopy.textContent = `Bugun ${usage.remaining} ta qoldi. Reset: ${formatDate(usage.resetAt)}`;
  } else {
    limitCopy.textContent = `Bugungi limit tugagan. Reset: ${formatDate(usage.resetAt)}`;
  }
}

function formatDate(timestamp) {
  return new Intl.DateTimeFormat("uz-UZ", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(timestamp));
}

function buildPrompt(userPrompt) {
  return [
    "Interpret the user's idea carefully and generate a single high-quality image.",
    "The user may write in Uzbek. Understand the meaning correctly.",
    "Output should be visually rich, polished, coherent, and compositionally strong.",
    "User prompt:",
    userPrompt,
  ].join("\n");
}
