import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Webcam from "react-webcam";
import * as tf from "@tensorflow/tfjs";
import * as cocoSsd from "@tensorflow-models/coco-ssd";

const CENTER_SAMPLE_SIZE = 50;
const OBJECT_CONFIDENCE_THRESHOLD = 0.6;

const TARGET_COLORS = {
  red: { hue: [345, 15], minSat: 14, minLight: 20, maxLight: 85 },
  orange: { hue: [16, 40], minSat: 12, minLight: 20, maxLight: 88 },
  yellow: { hue: [41, 70], minSat: 10, minLight: 22, maxLight: 95 },
  green: { hue: [71, 165], minSat: 12, minLight: 20, maxLight: 90 },
  blue: { hue: [166, 255], minSat: 10, minLight: 18, maxLight: 90 },
  purple: { hue: [256, 320], minSat: 12, minLight: 15, maxLight: 85 },
  pink: { hue: [321, 344], minSat: 10, minLight: 30, maxLight: 95 },
  brown: { hue: [16, 35], minSat: 10, minLight: 10, maxLight: 45 },
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
  const toastTimeoutRef = useRef(null);
  const [cameraEnabled, setCameraEnabled] = useState(false);
  const [challenge, setChallenge] = useState(null);
  const [status, setStatus] = useState("Tap Start Game to begin");
  const [avgRgb, setAvgRgb] = useState(null);
  const [isLoadingModel, setIsLoadingModel] = useState(false);
  const [isSubmittingFound, setIsSubmittingFound] = useState(false);
  const [isInfoOpen, setIsInfoOpen] = useState(false);
  const [toastMessage, setToastMessage] = useState("");
  const [successMessage, setSuccessMessage] = useState("");

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

  const showToast = useCallback((message, duration = 2200) => {
    setToastMessage(message);
    if (toastTimeoutRef.current) clearTimeout(toastTimeoutRef.current);
    toastTimeoutRef.current = setTimeout(() => {
      setToastMessage("");
    }, duration);
  }, []);

  const fetchChallenge = useCallback(async ({ forActiveGame = false } = {}) => {
    const userQuery = userId ? `?user_id=${encodeURIComponent(userId)}` : "";
    const response = await fetch(`${apiBaseUrl}/api/challenge${userQuery}`);
    if (!response.ok) {
      throw new Error("Could not fetch challenge");
    }
    const data = await response.json();
    setAvgRgb(null);
    setChallenge(data.challenge);
    const promptText =
      data.challenge.type === "color"
        ? `Find something ${data.challenge.target_value}!`
        : `Find a ${data.challenge.target_value}!`;

    if (forActiveGame) {
      setStatus(promptText);
    } else {
      setStatus(`Ready: ${promptText} Tap Start Game.`);
    }

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
    setStatus(
      `Success! You found ${challenge.target_value}. Tap Start Game to play again.`
    );
    showToast("Success! Game finished.");
    setSuccessMessage(
      `Great job! You found ${challenge.target_value}. Sticker unlocked.`
    );
    setCameraEnabled(false);

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
    } finally {
      setIsSubmittingFound(false);
    }
  }, [apiBaseUrl, challenge, isSubmittingFound, onStickerUnlocked, showToast, stopDetectionLoop, userId]);

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
    return () => {
      stopDetectionLoop();
      if (toastTimeoutRef.current) clearTimeout(toastTimeoutRef.current);
    };
  }, [stopDetectionLoop]);

  useEffect(() => {
    if (!cameraEnabled) {
      stopDetectionLoop();
      return;
    }

    let disposed = false;
    const initialize = async () => {
      try {
        const nextChallenge = await fetchChallenge({ forActiveGame: true });
        if (nextChallenge?.type === "object") {
          await ensureObjectModel();
        }
        if (disposed) return;
      } catch {
        setStatus("Could not initialize camera or model.");
      }
    };

    initialize();

    return () => {
      disposed = true;
      stopDetectionLoop();
    };
  }, [cameraEnabled, ensureObjectModel, fetchChallenge, stopDetectionLoop]);

  useEffect(() => {
    if (cameraEnabled && challenge) {
      stopDetectionLoop();
      startDetectionLoop();
    }
  }, [cameraEnabled, challenge, startDetectionLoop, stopDetectionLoop]);

  return (
    <section className="relative w-full rounded-3xl border-4 border-black bg-yellow-200 p-3 shadow-[0_8px_0_#111] md:p-4 md:shadow-[0_10px_0_#111]">
      {toastMessage && (
        <div className="mb-2 rounded-2xl border-4 border-black bg-white px-3 py-2 text-center text-base font-black text-black md:text-lg">
          {toastMessage}
        </div>
      )}

      <div className="mb-3">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-3xl font-black text-black md:text-4xl">The Magic Lens</h2>
          <button
            type="button"
            onClick={() => setIsInfoOpen(true)}
            className="h-12 min-w-12 rounded-xl border-4 border-black bg-white px-3 text-lg font-black text-black"
            aria-label="Game instructions"
          >
            Info
          </button>
        </div>
        <p className="mt-2 text-center text-xl font-bold text-black md:text-2xl">{status}</p>
      </div>

      <div className="relative h-[35vh] min-h-[220px] max-h-[340px] overflow-hidden rounded-2xl border-4 border-black bg-black md:h-[46vh] md:max-h-[440px]">
        <Webcam
          ref={webcamRef}
          audio={false}
          mirrored={false}
          screenshotFormat="image/jpeg"
          videoConstraints={videoConstraints}
          className="h-full w-full object-cover"
        />
        <div className="pointer-events-none absolute left-1/2 top-1/2 h-[50px] w-[50px] -translate-x-1/2 -translate-y-1/2 border-4 border-white shadow-[0_0_0_4px_#000]" />
        {!cameraEnabled && (
          <div className="pointer-events-none absolute inset-0 flex items-start justify-center bg-black/20 px-2 pt-2">
            <div className="rounded-xl border-4 border-black bg-white/95 px-3 py-2 text-center text-sm font-black text-black md:text-base">
              Game paused. Tap Start Game to detect this challenge.
            </div>
          </div>
        )}
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2 md:mt-4 md:gap-3">
        <button
          id="start-game-btn"
          type="button"
          onClick={() => {
            if (!cameraEnabled) {
              setChallenge(null);
              setAvgRgb(null);
              setSuccessMessage("");
              setStatus("Starting game. Getting one challenge...");
              showToast("Game started. Find this one target.");
              setCameraEnabled(true);
              return;
            }
            stopDetectionLoop();
            setCameraEnabled(false);
            setStatus("Game paused. Tap Start Game to continue.");
            showToast("Game paused.");
          }}
          className="min-h-[78px] rounded-2xl border-4 border-black bg-green-400 px-4 py-3 text-xl font-black text-black md:min-h-[96px] md:text-2xl"
        >
          {cameraEnabled ? "Stop Game" : "Start Game"}
        </button>
        <button
          id="new-challenge-btn"
          type="button"
          onClick={() => {
            if (cameraEnabled) {
              showToast("Finish this game first, or stop camera.");
              return;
            }
            fetchChallenge({ forActiveGame: false }).catch(() =>
              setStatus("Could not load challenge.")
            );
          }}
          disabled={cameraEnabled || isSubmittingFound}
          className="min-h-[78px] rounded-2xl border-4 border-black bg-cyan-300 px-4 py-3 text-xl font-black text-black disabled:cursor-not-allowed disabled:opacity-60 md:min-h-[96px] md:text-2xl"
        >
          New Challenge
        </button>
      </div>

      <div className="mt-3 rounded-2xl border-4 border-black bg-white p-3 text-base font-bold text-black md:mt-4 md:text-lg">
        <p>Detection: {cameraEnabled ? "RUNNING" : "PAUSED"}</p>
        <p>Mode: {challenge?.type ? challenge.type.toUpperCase() : "WAITING"}</p>
        <p>Target: {challenge?.target_value || "-"}</p>
        {challenge?.type === "color" && cameraEnabled && avgRgb && (
          <p>
            Center Color: rgb({Math.round(avgRgb.r)}, {Math.round(avgRgb.g)},{" "}
            {Math.round(avgRgb.b)})
          </p>
        )}
        {isLoadingModel && <p>Loading detection model...</p>}
      </div>

      {successMessage && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-3">
          <div className="w-full max-w-md rounded-3xl border-4 border-black bg-white p-4 shadow-[0_10px_0_#111]">
            <h3 className="text-2xl font-black text-black">Round Complete</h3>
            <p className="mt-3 text-lg font-bold text-black">{successMessage}</p>
            <button
              type="button"
              onClick={() => setSuccessMessage("")}
              className="mt-4 min-h-[72px] w-full rounded-2xl border-4 border-black bg-green-300 text-xl font-black text-black"
            >
              OK
            </button>
          </div>
        </div>
      )}

      {isInfoOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-3">
          <div className="w-full max-w-md rounded-3xl border-4 border-black bg-white p-4 shadow-[0_10px_0_#111]">
            <h3 className="text-2xl font-black text-black">How To Play</h3>
            <ol className="mt-3 list-decimal space-y-1 pl-5 text-lg font-bold text-black">
              <li>Tap Start Game to begin detection.</li>
              <li>Read the target at the top.</li>
              <li>Aim the center square at matching object or color.</li>
              <li>When found, a success popup appears and the round ends.</li>
            </ol>
            <p className="mt-3 text-base font-bold text-black">
              Tip: Use good lighting to improve detection.
            </p>
            <button
              type="button"
              onClick={() => setIsInfoOpen(false)}
              className="mt-4 min-h-[72px] w-full rounded-2xl border-4 border-black bg-yellow-200 text-xl font-black text-black"
            >
              Close
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
