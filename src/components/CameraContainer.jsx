import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Webcam from "react-webcam";
import * as tf from "@tensorflow/tfjs";
import * as cocoSsd from "@tensorflow-models/coco-ssd";

const CENTER_SAMPLE_SIZE = 50;
const OBJECT_CONFIDENCE_THRESHOLD = 0.6;

const TARGET_COLORS = {
  red: { hue: [345, 15], minSat: 35, minLight: 20, maxLight: 85 },
  orange: { hue: [16, 40], minSat: 35, minLight: 20, maxLight: 88 },
  yellow: { hue: [41, 70], minSat: 35, minLight: 25, maxLight: 92 },
  green: { hue: [71, 165], minSat: 25, minLight: 20, maxLight: 90 },
  blue: { hue: [166, 255], minSat: 25, minLight: 18, maxLight: 88 },
  purple: { hue: [256, 320], minSat: 25, minLight: 15, maxLight: 85 },
  pink: { hue: [321, 344], minSat: 20, minLight: 30, maxLight: 95 },
  brown: { hue: [16, 35], minSat: 25, minLight: 10, maxLight: 45 },
  black: { hue: [0, 359], minSat: 0, minLight: 0, maxLight: 15 },
  white: { hue: [0, 359], minSat: 0, minLight: 82, maxLight: 100 },
  gray: { hue: [0, 359], minSat: 0, minLight: 15, maxLight: 82 },
};

function normalizeColor(value) {
  return (value || "").trim().toLowerCase();
}

function hueInRange(h, start, end) {
  if (start <= end) return h >= start && h <= end;
  return h >= start || h <= end;
}

function rgbToHsl(r, g, b) {
  const nr = r / 255;
  const ng = g / 255;
  const nb = b / 255;
  const max = Math.max(nr, ng, nb);
  const min = Math.min(nr, ng, nb);
  let h = 0;
  let s = 0;
  const l = (max + min) / 2;
  const d = max - min;

  if (d !== 0) {
    s = d / (1 - Math.abs(2 * l - 1));
    switch (max) {
      case nr:
        h = 60 * (((ng - nb) / d) % 6);
        break;
      case ng:
        h = 60 * ((nb - nr) / d + 2);
        break;
      default:
        h = 60 * ((nr - ng) / d + 4);
        break;
    }
  }

  if (h < 0) h += 360;
  return { h, s: s * 100, l: l * 100 };
}

function isColorMatch(avgRgb, targetColorName) {
  const target = TARGET_COLORS[targetColorName];
  if (!target) return false;

  const hsl = rgbToHsl(avgRgb.r, avgRgb.g, avgRgb.b);
  const [start, end] = target.hue;
  const hueMatches = hueInRange(hsl.h, start, end);
  const satMatches = hsl.s >= target.minSat;
  const lightMatches = hsl.l >= target.minLight && hsl.l <= target.maxLight;

  if (targetColorName === "black" || targetColorName === "white" || targetColorName === "gray") {
    return lightMatches;
  }

  return hueMatches && satMatches && lightMatches;
}

function averageRgbFromCenter(video, canvas, sampleSize) {
  const width = video.videoWidth;
  const height = video.videoHeight;
  if (!width || !height) return null;

  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;

  ctx.drawImage(video, 0, 0, width, height);
  const x = Math.max(0, Math.floor(width / 2 - sampleSize / 2));
  const y = Math.max(0, Math.floor(height / 2 - sampleSize / 2));
  const imageData = ctx.getImageData(x, y, sampleSize, sampleSize).data;

  let totalR = 0;
  let totalG = 0;
  let totalB = 0;
  let count = 0;

  for (let i = 0; i < imageData.length; i += 4) {
    totalR += imageData[i];
    totalG += imageData[i + 1];
    totalB += imageData[i + 2];
    count += 1;
  }

  if (count === 0) return null;
  return {
    r: totalR / count,
    g: totalG / count,
    b: totalB / count,
  };
}

export default function CameraContainer({
  userId,
  apiBaseUrl = "",
  onStickerUnlocked,
}) {
  const webcamRef = useRef(null);
  const sampleCanvasRef = useRef(null);
  const modelRef = useRef(null);
  const frameRequestRef = useRef(null);
  const checkingRef = useRef(false);
  const modelLoadPromiseRef = useRef(null);
  const [cameraEnabled, setCameraEnabled] = useState(false);
  const [challenge, setChallenge] = useState(null);
  const [status, setStatus] = useState("Tap Start Camera to begin");
  const [avgRgb, setAvgRgb] = useState(null);
  const [isLoadingModel, setIsLoadingModel] = useState(false);
  const [isSubmittingFound, setIsSubmittingFound] = useState(false);

  const videoConstraints = useMemo(
    () => ({
      facingMode: { ideal: "environment" },
      width: { ideal: 1280 },
      height: { ideal: 720 },
    }),
    []
  );

  const stopDetectionLoop = useCallback(() => {
    if (frameRequestRef.current) {
      cancelAnimationFrame(frameRequestRef.current);
      frameRequestRef.current = null;
    }
    checkingRef.current = false;
  }, []);

  const fetchChallenge = useCallback(async () => {
    const userQuery = userId ? `?user_id=${encodeURIComponent(userId)}` : "";
    const response = await fetch(`${apiBaseUrl}/api/challenge${userQuery}`);
    if (!response.ok) {
      throw new Error("Could not fetch challenge");
    }
    const data = await response.json();
    setChallenge(data.challenge);
    setStatus(
      data.challenge.type === "color"
        ? `Find something ${data.challenge.target_value}!`
        : `Find a ${data.challenge.target_value}!`
    );

    if (data.challenge.audio_prompt_url) {
      const audio = new Audio(data.challenge.audio_prompt_url);
      audio.play().catch(() => {});
    }

    return data.challenge;
  }, [apiBaseUrl, userId]);

  const ensureObjectModel = useCallback(async () => {
    if (modelRef.current) return modelRef.current;
    if (modelLoadPromiseRef.current) return modelLoadPromiseRef.current;

    setIsLoadingModel(true);
    modelLoadPromiseRef.current = (async () => {
      await tf.ready();
      modelRef.current = await cocoSsd.load();
      return modelRef.current;
    })();

    try {
      return await modelLoadPromiseRef.current;
    } finally {
      modelLoadPromiseRef.current = null;
      setIsLoadingModel(false);
    }
  }, []);

  const submitFound = useCallback(async () => {
    if (!challenge || isSubmittingFound) return;
    setIsSubmittingFound(true);
    stopDetectionLoop();
    setStatus("Great Job! Sticker unlocked!");

    try {
      if (userId) {
        const response = await fetch(`${apiBaseUrl}/api/found`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            user_id: userId,
            challenge_id: challenge.id,
          }),
        });
        if (response.ok) {
          const data = await response.json();
          onStickerUnlocked?.(data.unlocked);
        }
      }
      const successAudio = new Audio("/audio/success.mp3");
      successAudio.play().catch(() => {});
      setTimeout(() => {
        fetchChallenge().catch(() => setStatus("Tap retry to get a new challenge."));
      }, 1200);
    } finally {
      setTimeout(() => setIsSubmittingFound(false), 800);
    }
  }, [apiBaseUrl, challenge, fetchChallenge, isSubmittingFound, onStickerUnlocked, stopDetectionLoop, userId]);

  const runObjectCheck = useCallback(async () => {
    const webcam = webcamRef.current;
    const model = modelRef.current || (await ensureObjectModel());
    const video = webcam?.video;
    if (!model || !video || video.readyState !== 4 || !challenge) return false;

    const target = normalizeColor(challenge.target_value);
    const detections = await model.detect(video);
    return detections.some(
      (item) =>
        item.score >= OBJECT_CONFIDENCE_THRESHOLD &&
        (normalizeColor(item.class) === target ||
          normalizeColor(item.class).includes(target) ||
          target.includes(normalizeColor(item.class)))
    );
  }, [challenge, ensureObjectModel]);

  const runColorCheck = useCallback(() => {
    const webcam = webcamRef.current;
    const video = webcam?.video;
    if (!video || video.readyState !== 4 || !challenge || !sampleCanvasRef.current) {
      return false;
    }

    const avg = averageRgbFromCenter(video, sampleCanvasRef.current, CENTER_SAMPLE_SIZE);
    setAvgRgb(avg);
    if (!avg) return false;

    return isColorMatch(avg, normalizeColor(challenge.target_value));
  }, [challenge]);

  const startDetectionLoop = useCallback(() => {
    if (checkingRef.current) return;
    checkingRef.current = true;

    const tick = async () => {
      if (!checkingRef.current || !challenge || isSubmittingFound) return;
      try {
        const found =
          challenge.type === "object" ? await runObjectCheck() : runColorCheck();

        if (found) {
          await submitFound();
          return;
        }
      } catch {
        setStatus("Detection paused. Tap retry.");
      }

      frameRequestRef.current = requestAnimationFrame(tick);
    };

    frameRequestRef.current = requestAnimationFrame(tick);
  }, [challenge, isSubmittingFound, runColorCheck, runObjectCheck, submitFound]);

  useEffect(() => {
    sampleCanvasRef.current = document.createElement("canvas");
    return () => stopDetectionLoop();
  }, [stopDetectionLoop]);

  useEffect(() => {
    if (!cameraEnabled) {
      stopDetectionLoop();
      return;
    }

    let disposed = false;
    const initialize = async () => {
      try {
        const nextChallenge = await fetchChallenge();
        if (nextChallenge?.type === "object") {
          await ensureObjectModel();
        }
        if (!disposed) startDetectionLoop();
      } catch {
        setStatus("Could not initialize camera or model.");
      }
    };

    initialize();

    return () => {
      disposed = true;
      stopDetectionLoop();
    };
  }, [cameraEnabled, ensureObjectModel, fetchChallenge, startDetectionLoop, stopDetectionLoop]);

  useEffect(() => {
    if (cameraEnabled && challenge) {
      stopDetectionLoop();
      startDetectionLoop();
    }
  }, [cameraEnabled, challenge, startDetectionLoop, stopDetectionLoop]);

  return (
    <section className="w-full rounded-3xl border-4 border-black bg-yellow-200 p-4 shadow-[0_10px_0_#111]">
      <div className="mb-4 text-center">
        <h2 className="text-3xl font-black text-black">The Magic Lens</h2>
        <p className="mt-2 text-xl font-bold text-black">{status}</p>
      </div>

      <div className="relative overflow-hidden rounded-2xl border-4 border-black bg-black">
        <Webcam
          ref={webcamRef}
          audio={false}
          mirrored={false}
          screenshotFormat="image/jpeg"
          videoConstraints={videoConstraints}
          className="h-auto w-full"
        />
        <div className="pointer-events-none absolute left-1/2 top-1/2 h-[50px] w-[50px] -translate-x-1/2 -translate-y-1/2 border-4 border-white shadow-[0_0_0_4px_#000]" />
      </div>

      <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2">
        <button
          type="button"
          onClick={() => setCameraEnabled((v) => !v)}
          className="min-h-[100px] rounded-2xl border-4 border-black bg-green-400 px-6 py-4 text-2xl font-black text-black"
        >
          {cameraEnabled ? "Stop Camera" : "Start Camera"}
        </button>
        <button
          type="button"
          onClick={() => {
            fetchChallenge().catch(() => setStatus("Could not load challenge."));
          }}
          className="min-h-[100px] rounded-2xl border-4 border-black bg-cyan-300 px-6 py-4 text-2xl font-black text-black"
        >
          New Challenge
        </button>
      </div>

      <div className="mt-4 rounded-2xl border-4 border-black bg-white p-3 text-lg font-bold text-black">
        <p>Mode: {challenge?.type ? challenge.type.toUpperCase() : "WAITING"}</p>
        <p>Target: {challenge?.target_value || "-"}</p>
        {challenge?.type === "color" && avgRgb && (
          <p>
            Center Color: rgb({Math.round(avgRgb.r)}, {Math.round(avgRgb.g)},{" "}
            {Math.round(avgRgb.b)})
          </p>
        )}
        {isLoadingModel && <p>Loading detection model...</p>}
      </div>
    </section>
  );
}
