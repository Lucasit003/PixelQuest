import {
  AbsoluteFill,
  Easing,
  Img,
  interpolate,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";

// The Thorn King rises from his throne.
//
// THE STAND-UP IS ANIMATED, NOT CROSSFADED. Dissolving between a seated
// painting and a standing one can never read as standing up — it reads as a
// double exposure, because nothing in between is ever shown. So the in-between
// poses are generated: the profile figure is cut at the hip and knee and driven
// through a real stand — pitch the torso forward over the feet FIRST, load
// them, drive up, then straighten. Nobody stands by extending their legs from a
// seated position; they get their weight above their base and then push. The 36
// frames in public/art/rise/ come from that rig, off the approved painting.
//
// FRAMING. The throne sits at the far right of the chamber, so a shot that puts
// it near centre also drags the room's right edge into view. This is therefore
// right-weighted, with the hall running away to the left.
//
// He used to walk down the dais after standing. That is cut: the walk was the
// weakest thing on screen — a flat painting has no second leg and no arm to
// swing, so a gait built from it can only ever approximate one — and the rise
// alone is the stronger beat. The walk rig is still in the repo if it is wanted.

const SEAT_X = 1277;      // the throne, measured off the painted room
const STEP_Y = 653;       // the step his boots stand on

// Smaller than the previous pass: at that size he filled so much of the frame
// that the hall stopped reading as a hall.
const STAND_H = 470;      // his standing height in frame px
const RIG = 414;          // the same figure's height inside the rig canvas
const K = STAND_H / RIG;

// The rig canvas is fixed so every generated frame aligns: 460x640, step line at
// y520, body centre line at x250. Placing those two landmarks is all the
// composition has to do — the animation itself is baked into the frames.
const RIG_W = 460 * K;
const RIG_H = 640 * K;
const RIG_LEFT = SEAT_X - 250 * K;
const RIG_TOP = STEP_Y - 520 * K;

const RISE_FRAMES = 36;

export const ThroneRise: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const riseStart = Math.round(3.2 * fps);
  const riseEnd = Math.round(7.0 * fps);

  // Which generated pose to show: held on the first while he sits, stepped
  // through during the rise, held on the last afterwards.
  const poseU = interpolate(frame, [riseStart, riseEnd], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.bezier(0.5, 0, 0.4, 1),
  });
  const pose = Math.min(RISE_FRAMES - 1, Math.max(0, Math.round(poseU * (RISE_FRAMES - 1))));

  const poseSrc = staticFile(`art/rise/rise_${String(pose).padStart(2, "0")}.png`);

  const camScale = interpolate(
    frame,
    [0, riseStart, riseEnd, 10 * fps],
    [1.04, 1.055, 1.01, 1.0],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: Easing.bezier(0.33, 1, 0.68, 1) },
  );
  const camY = interpolate(frame, [0, riseEnd], [14, -6], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.bezier(0.33, 1, 0.68, 1),
  });

  // The thorn light kindles as he comes upright, not before.
  const teal = interpolate(frame, [riseEnd - 34, riseEnd + 40], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  const bars = interpolate(frame, [0, 26], [0, 46], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.bezier(0.33, 1, 0.68, 1),
  });

  const figure = {
    position: "absolute" as const,
    left: RIG_LEFT,
    top: RIG_TOP,
    width: RIG_W,
    height: RIG_H,
  };

  return (
    <AbsoluteFill style={{ backgroundColor: "#0b0d0c" }}>
      <AbsoluteFill
        style={{ scale: camScale, translate: `0px ${camY}px`, transformOrigin: "88% 62%" }}
      >
        <Img
          src={staticFile("art/throne_shot.jpg")}
          style={{ position: "absolute", left: 0, top: 0, width: 1440, height: 810 }}
        />

        <Img src={poseSrc} style={figure} />

        {/* the thorn light, on the SAME pose so it can never drift off him */}
        <Img
          src={poseSrc}
          style={{
            ...figure,
            opacity: teal * 0.15,
            filter: "brightness(1.5) grayscale(1) sepia(1) hue-rotate(130deg) saturate(3)",
            mixBlendMode: "screen",
          }}
        />
      </AbsoluteFill>

      <AbsoluteFill
        style={{ backgroundColor: "#101c22", opacity: 0.2 - teal * 0.09, mixBlendMode: "multiply" }}
      />
      <AbsoluteFill
        style={{
          background:
            "radial-gradient(ellipse at 86% 58%, rgba(0,0,0,0) 34%, rgba(0,0,0,0.58) 100%)",
        }}
      />

      <AbsoluteFill style={{ pointerEvents: "none" }}>
        <div style={{ position: "absolute", left: 0, right: 0, top: 0, height: bars, backgroundColor: "#000" }} />
        <div style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: bars, backgroundColor: "#000" }} />
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
