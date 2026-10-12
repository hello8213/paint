
"use strict";

const $ = id => document.getElementById(id);

const fileInput = $("fileInput");
const dropzone = $("dropzone");
const preview = $("preview");
const previewWrap = $("previewWrap");
const analyzeBtn = $("analyzeBtn");
const errorBox = $("error");

let currentFile = null;
let currentImage = null;
let currentObjectURL = null;
let reportText = "";

function showError(message) {
  errorBox.textContent = message;
  errorBox.classList.remove("hidden");
}

function clearError() {
  errorBox.textContent = "";
  errorBox.classList.add("hidden");
}

function escapeHTML(value) {
  return String(value).replace(/[&<>"']/g, char => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  })[char]);
}

function average(values) {
  return values.length
    ? values.reduce((sum, value) => sum + value, 0) / values.length
    : 0;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function formatBytes(bytes) {
  return bytes < 1024 * 1024
    ? `${Math.round(bytes / 1024)} KB`
    : `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

$("chooseBtn").addEventListener("click", event => {
  event.stopPropagation();
  fileInput.click();
});

dropzone.addEventListener("click", () => fileInput.click());

dropzone.addEventListener("keydown", event => {
  if (event.key === "Enter" || event.key === " ") {
    event.preventDefault();
    fileInput.click();
  }
});

fileInput.addEventListener("change", () => {
  if (fileInput.files && fileInput.files[0]) {
    loadFile(fileInput.files[0]);
  }
});

["dragenter", "dragover"].forEach(type => {
  dropzone.addEventListener(type, event => {
    event.preventDefault();
    dropzone.classList.add("dragover");
  });
});

["dragleave", "drop"].forEach(type => {
  dropzone.addEventListener(type, event => {
    event.preventDefault();
    dropzone.classList.remove("dragover");
  });
});

dropzone.addEventListener("drop", event => {
  const file = event.dataTransfer?.files?.[0];
  if (file) loadFile(file);
});

$("removeBtn").addEventListener("click", clearImage);

$("resetBtn").addEventListener("click", () => {
  clearImage();
  $("reportSection").classList.add("hidden");
  reportText = "";
});

analyzeBtn.addEventListener("click", analyze);
$("downloadBtn").addEventListener("click", downloadReport);

function loadFile(file) {
  clearError();

  if (!file.type.startsWith("image/")) {
    showError("请选择 PNG、JPG、WEBP 等图片文件。");
    return;
  }

  if (file.size > 15 * 1024 * 1024) {
    showError("图片超过 15 MB，请选择较小的图片。");
    return;
  }

  const objectURL = URL.createObjectURL(file);
  const image = new Image();

  image.onload = () => {
    if (!image.naturalWidth || !image.naturalHeight) {
      URL.revokeObjectURL(objectURL);
      showError("无法读取这张图片，请换一张试试。");
      return;
    }

    if (currentObjectURL) URL.revokeObjectURL(currentObjectURL);

    currentObjectURL = objectURL;
    currentFile = file;
    currentImage = image;

    preview.src = objectURL;
    $("fileName").textContent = file.name;
    $("imageMeta").textContent =
      `${image.naturalWidth} × ${image.naturalHeight} px · ${formatBytes(file.size)}`;

    previewWrap.classList.remove("hidden");
    dropzone.classList.add("hidden");
    analyzeBtn.disabled = false;
    $("reportSection").classList.add("hidden");
  };

  image.onerror = () => {
    URL.revokeObjectURL(objectURL);
    showError("图片读取失败，请尝试另存为 JPG 或 PNG。");
  };

  image.src = objectURL;
}

function clearImage() {
  clearError();

  if (currentObjectURL) URL.revokeObjectURL(currentObjectURL);

  currentObjectURL = null;
  currentFile = null;
  currentImage = null;
  fileInput.value = "";

  preview.removeAttribute("src");
  previewWrap.classList.add("hidden");
  dropzone.classList.remove("hidden");
  analyzeBtn.disabled = true;
  $("reportSection").classList.add("hidden");
}

function analyze() {
  clearError();

  if (!currentImage) {
    showError("请先上传一张图片。");
    return;
  }

  analyzeBtn.disabled = true;
  analyzeBtn.textContent = "正在分析…";

  try {
    const maxSide = 300;
    const scale = Math.min(
      1,
      maxSide / Math.max(currentImage.naturalWidth, currentImage.naturalHeight)
    );

    const width = Math.max(1, Math.round(currentImage.naturalWidth * scale));
    const height = Math.max(1, Math.round(currentImage.naturalHeight * scale));

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;

    const context = canvas.getContext("2d", {
      willReadFrequently: true
    });

    if (!context) throw new Error("浏览器无法启动图像分析。");

    context.drawImage(currentImage, 0, 0, width, height);

    const data = context.getImageData(0, 0, width, height).data;
    const luminances = [];
    const saturations = [];
    let red = 0;
    let green = 0;
    let blue = 0;
    let brightCount = 0;
    let edgeSum = 0;
    let edgeCount = 0;

    const colorBins = new Map();

    function getLuminance(x, y) {
      const i = (y * width + x) * 4;
      return 0.2126 * data[i] +
        0.7152 * data[i + 1] +
        0.0722 * data[i + 2];
    }

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = (y * width + x) * 4;
        const r = data[i];
        const g = data[i + 1];
        const b = data[i + 2];

        red += r;
        green += g;
        blue += b;

        const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
        luminances.push(luminance);

        if (luminance > 200) brightCount++;

        const maximum = Math.max(r, g, b);
        const minimum = Math.min(r, g, b);
        saturations.push(
          maximum === 0 ? 0 : (maximum - minimum) / maximum * 100
        );

        const qr = clamp(Math.round(r / 32) * 32, 0, 255);
        const qg = clamp(Math.round(g / 32) * 32, 0, 255);
        const qb = clamp(Math.round(b / 32) * 32, 0, 255);
        const key = `${qr},${qg},${qb}`;

        colorBins.set(key, (colorBins.get(key) || 0) + 1);

        if (x > 0) {
          edgeSum += Math.abs(luminance - getLuminance(x - 1, y));
          edgeCount++;
        }

        if (y > 0) {
          edgeSum += Math.abs(luminance - getLuminance(x, y - 1));
          edgeCount++;
        }
      }
    }

    const avgLuminance = average(luminances);
    const luminanceVariance = average(
      luminances.map(value => (value - avgLuminance) ** 2)
    );
    const luminanceStd = Math.sqrt(luminanceVariance);

    const contrast = clamp(luminanceStd / 128 * 100, 0, 100);
    const saturation = average(saturations);
    const edgeDensity = clamp(
      edgeSum / Math.max(edgeCount, 1) / 64 * 100,
      0,
      100
    );

    const aspect =
      currentImage.naturalWidth / currentImage.naturalHeight;

    const palette = [...colorBins.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([key]) => {
        const [r, g, b] = key.split(",").map(Number);
        return {
          hex: "#" + [r, g, b]
            .map(value => value.toString(16).padStart(2, "0"))
            .join("")
            .toUpperCase()
        };
      });

    const report = buildReport({
      width: currentImage.naturalWidth,
      height: currentImage.naturalHeight,
      avgLuminance,
      contrast,
      saturation,
      edgeDensity,
      brightRatio: brightCount / luminances.length,
      aspect,
      palette
    });

    renderReport(report);

    $("reportSubtitle").textContent =
      `${currentFile.name} · 浏览器本地采样分析`;

    $("reportSection").classList.remove("hidden");
    $("reportSection").scrollIntoView({
      behavior: "smooth",
      block: "start"
    });
  } catch (error) {
    showError(error instanceof Error
      ? error.message
      : "分析失败，请换一张图片重试。");
  } finally {
    analyzeBtn.disabled = !currentImage;
    analyzeBtn.textContent = "分析这幅画 ↗";
  }
}

function buildReport(data) {
  const observations = [];
  const strengths = [];
  const suggestions = [];

  let brightnessLabel;

  if (data.avgLuminance < 75) {
    brightnessLabel = "整体偏暗";
  } else if (data.avgLuminance > 185) {
    brightnessLabel = "整体偏亮";
  } else {
    brightnessLabel = "整体亮度适中";
  }

  const contrastLabel = data.contrast < 18
    ? "明暗跨度较柔和"
    : data.contrast > 42
      ? "明暗变化较强"
      : "明暗变化适中";

  const saturationLabel = data.saturation < 22
    ? "整体色彩较克制"
    : data.saturation > 58
      ? "整体色彩鲜明"
      : "整体饱和度适中";

  observations.push(
    `${brightnessLabel}，平均亮度为 ${data.avgLuminance.toFixed(0)}/255。`
  );

  observations.push(
    `${contrastLabel}，相对对比指标为 ${data.contrast.toFixed(0)}/100。`
  );

  observations.push(
    `${saturationLabel}，平均饱和度为 ${data.saturation.toFixed(0)}%。`
  );

  observations.push(
    `边缘变化指标为 ${data.edgeDensity.toFixed(0)}/100。纹理、线条和噪点都可能影响这个数值。`
  );

  observations.push(
    `宽高比约为 ${data.aspect.toFixed(2)}。画幅比例只是形式信息，不代表作品优劣。`
  );

  strengths.push(
    data.contrast >= 22
      ? "画面存在可测量的明暗变化，可以观察它们是否帮助突出主体。"
      : "画面的明暗变化比较柔和，可以检查这种统一感是否符合创作意图。"
  );

  strengths.push(
    data.saturation >= 35
      ? "画面含有较明显的色彩信息，可以观察高饱和颜色是否集中在重点区域。"
      : "整体色彩较克制，可以检查有限色彩是否形成统一的气氛。"
  );

  strengths.push(
    data.edgeDensity > 25
      ? "图像有较多边缘或纹理变化，值得检查细节是否有主次。"
      : "边缘变化相对不密集，可以观察大形体、轮廓与留白的关系。"
  );

  suggestions.push(
    data.avgLuminance < 90
      ? "检查暗部是否仍保留需要的形状和层次；如果你在画夜景，不必为了提亮而改变原本意图。"
      : data.avgLuminance > 180
        ? "检查亮部是否丢失重要细节，并比较最亮处与主体之间的层次。"
        : "把画面缩小到缩略图观察，检查第一眼的视觉焦点是否清楚。"
  );

  suggestions.push(
    data.contrast < 18
      ? "尝试画一张三到五档的黑白明度稿，比较主体与背景的分离程度。"
      : data.contrast > 42
        ? "检查强对比是否集中在重点区域，避免所有区域都争夺注意力。"
        : "挑出画面最亮、最暗和中间调三个区域，检查它们之间的关系。"
  );

  suggestions.push(
    data.saturation < 22
      ? "如果希望某个区域更醒目，可以只调整局部颜色，而不是整张画一起增加饱和度。"
      : data.saturation > 58
        ? "尝试用一个主色、一个辅助色和少量强调色制作色稿，比较层次是否清晰。"
        : "挑选两种主色做一张小色稿，比较相邻色和互补色带来的不同效果。"
  );

  suggestions.push(
    "请找一位同学或老师看作品五秒钟，再问对方第一眼看到了哪里，并与你的创作意图进行比较。"
  );

  const ratioLabel = data.aspect > 1.2
    ? "横向画幅"
    : data.aspect < 0.83
      ? "纵向画幅"
      : "接近方形的画幅";

  return {
    data,
    brightnessLabel,
    contrastLabel,
    saturationLabel,
    observations,
    strengths,
    suggestions,
    ratioLabel
  };
}

function renderReport(report) {
  const d = report.data;

  const metrics = [
    ["画面尺寸", `${d.width} × ${d.height}`, "像素"],
    ["平均亮度", d.avgLuminance.toFixed(0), "0–255"],
    ["明暗对比", d.contrast.toFixed(0), "相对指标 / 100"],
    ["平均饱和度", `${d.saturation.toFixed(0)}%`, "估算值"],
    ["边缘变化", d.edgeDensity.toFixed(0), "相对指标 / 100"],
    ["亮部像素", `${(d.brightRatio * 100).toFixed(1)}%`, "亮度高于 200"],
    ["画幅类型", report.ratioLabel, "宽高比估算"],
    ["宽高比", d.aspect.toFixed(2), "宽度 ÷ 高度"]
  ];

  $("metrics").innerHTML = metrics.map(([label, value, note]) => `
    <div class="metric">
      <div class="metric-label">${escapeHTML(label)}</div>
      <div class="metric-value">${escapeHTML(value)}</div>
      <div class="metric-note">${escapeHTML(note)}</div>
    </div>
  `).join("");

  $("palette").innerHTML = d.palette.map(color => `
    <div class="swatch">
      <div class="swatch-color" style="background:${color.hex}"></div>
      <span class="swatch-code">${color.hex}</span>
    </div>
  `).join("");

  $("paletteText").textContent =
    `代表色近似为 ${d.palette.map(color => color.hex).join("、")}。这些颜色来自缩略图采样，不等于作品完整的调色方案。`;

  fillList("observations", report.observations);
  fillList("strengths", report.strengths);
  fillList("suggestions", report.suggestions);

  reportText = makeTextReport(report);
}

function fillList(id, items) {
  $(id).innerHTML = items.map((item, index) => `
    <div class="report-item">
      <span>${index + 1}</span>
      <div>${escapeHTML(item)}</div>
    </div>
  `).join("");
}

function makeTextReport(report) {
  const d = report.data;

  return `绘画观察室｜作品观察报告
文件：${currentFile ? currentFile.name : "未命名"}
尺寸：${d.width} × ${d.height} px
平均亮度：${d.avgLuminance.toFixed(0)}/255
明暗对比指标：${d.contrast.toFixed(0)}/100
平均饱和度：${d.saturation.toFixed(0)}%
边缘变化指标：${d.edgeDensity.toFixed(0)}/100
亮部像素：${(d.brightRatio * 100).toFixed(1)}%
画幅：${report.ratioLabel}
宽高比：${d.aspect.toFixed(2)}
代表色：${d.palette.map(color => color.hex).join(", ")}

色彩与明暗观察
${report.observations.map((x, i) => `${i + 1}. ${x}`).join("\n")}

可能的优势
${report.strengths.map((x, i) => `${i + 1}. ${x}`).join("\n")}

下一步练习建议
${report.suggestions.map((x, i) => `${i + 1}. ${x}`).join("\n")}

说明：本报告由浏览器内的图像统计与规则生成，不包含视觉 AI 的语义理解。数值会受拍摄光线、扫描质量和图片压缩影响。`;
}

function downloadReport() {
  if (!reportText) return;

  const blob = new Blob([reportText], {
    type: "text/plain;charset=utf-8"
  });

  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");

  link.href = url;
  link.download = "绘画观察报告.txt";
  document.body.appendChild(link);
  link.click();
  link.remove();

  URL.revokeObjectURL(url);
}

