import React, { useRef } from "react";
import { Dimensions, StyleSheet } from "react-native";
import { Canvas, Path, LinearGradient, vec, useClock, BlurMask, Circle, SweepGradient } from "@shopify/react-native-skia";
import { useDerivedValue } from "react-native-reanimated";

const { width, height } = Dimensions.get("window");

// Blue/black/white bubble configuration
const BUBBLES = [
  { r: 60, baseColor: "#26A7DE", blur: 30, xFactor: 0.2, yFactor: 0.1, speed: 1.1, opacity: 0.22, phase: 0 },
  { r: 40, baseColor: "#00F0FF", blur: 20, xFactor: 0.7, yFactor: 0.2, speed: 1.5, opacity: 0.18, phase: 1 },
  { r: 80, baseColor: "#B5FFFC", blur: 40, xFactor: 0.5, yFactor: 0.8, speed: 0.8, opacity: 0.15, phase: 2 },
  { r: 30, baseColor: "#23272A", blur: 18, xFactor: 0.8, yFactor: 0.6, speed: 1.7, opacity: 0.22, phase: 3 },
  { r: 50, baseColor: "#282828", blur: 25, xFactor: 0.3, yFactor: 0.9, speed: 1.3, opacity: 0.16, phase: 4 },
  { r: 35, baseColor: "#B5FFFC", blur: 15, xFactor: 0.6, yFactor: 0.4, speed: 1.9, opacity: 0.19, phase: 5 },
  { r: 55, baseColor: "#00F0FF", blur: 22, xFactor: 0.15, yFactor: 0.7, speed: 1.2, opacity: 0.13, phase: 6 },
  { r: 45, baseColor: "#23272A", blur: 19, xFactor: 0.85, yFactor: 0.3, speed: 1.6, opacity: 0.17, phase: 7 },
  { r: 38, baseColor: "#26A7DE", blur: 16, xFactor: 0.4, yFactor: 0.5, speed: 1.4, opacity: 0.15, phase: 8 },
  { r: 28, baseColor: "#fff", blur: 12, xFactor: 0.65, yFactor: 0.15, speed: 2.1, opacity: 0.18, phase: 9 },
];

// Add extra bubbles at the top
const TOP_BUBBLES = [
  { r: 32, baseColor: "#B5FFFC", blur: 18, xFactor: 0.18, yFactor: 0.08, speed: 2.2, opacity: 0.22, phase: 0.5 },
  { r: 24, baseColor: "#00F0FF", blur: 12, xFactor: 0.82, yFactor: 0.12, speed: 2.7, opacity: 0.19, phase: 1.2 },
  { r: 28, baseColor: "#26A7DE", blur: 14, xFactor: 0.5, yFactor: 0.05, speed: 2.9, opacity: 0.21, phase: 2.1 },
];

// Comet state
function useComet(clock: any) {
  // Animate comet every 2 seconds for debugging
  const cometState = useRef({
    startX: 0,
    endX: width,
    y: 40,
    duration: 2000,
    startTime: Date.now(),
    color: '#FFFF00', // neon yellow
  });
  const comet = useDerivedValue(() => {
    const now = Date.now();
    let { startX, endX, y, duration, startTime, color } = cometState.current;
    let t = (now - startTime) / duration;
    if (t > 1) {
      startTime = now;
      cometState.current = { startX, endX, y, duration, startTime, color };
      t = 0;
    }
    const x = startX + (endX - startX) * t;
    return { x, y, t, color };
  }, [clock]);
  return comet;
}

export default function FluidLoginBackground() {
  const clock = useClock();

  // Fluid layers (blue/black gradients)
  const path = useDerivedValue(() => {
    const t = clock.value / 700;
    // Dramatic top wave
    const p0 = { x: 0, y: 0 };
    const p1 = { x: width * 0.2, y: 60 + Math.sin(t * 2.2) * 40 };
    const p2 = { x: width * 0.5, y: 90 + Math.cos(t * 2.7) * 60 };
    const p3 = { x: width * 0.8, y: 60 + Math.sin(t * 2.1) * 40 };
    const p4 = { x: width, y: 0 };
    // Lower wave as before
    const p5 = { x: width, y: height };
    const p6 = { x: 0, y: height };
    return `M${p0.x},${p0.y} Q${p1.x},${p1.y} ${p2.x},${p2.y} Q${p3.x},${p3.y} ${p4.x},${p4.y} L${p5.x},${p5.y} L${p6.x},${p6.y} Z`;
  }, [clock]);
  const path2 = useDerivedValue(() => {
    const t = clock.value / 900 + 1.5;
    const p1 = { x: width * (0.15 + 0.07 * Math.cos(t * 1.2)), y: height * 0.7 + Math.sin(t) * 180 };
    const p2 = { x: width * (0.5 + 0.09 * Math.sin(t * 1.7)), y: height * 0.6 + Math.cos(t * 1.1) * 260 };
    const p3 = { x: width * (0.85 + 0.07 * Math.cos(t * 1.3)), y: height * 0.7 + Math.sin(t * 0.7) * 180 };
    return `M0,0 L0,${height} Q${p1.x},${p1.y} ${p2.x},${p2.y} Q${p3.x},${p3.y} ${width},${height} L${width},0 Z`;
  }, [clock]);
  const path3 = useDerivedValue(() => {
    const t = clock.value / 1100 + 2.5;
    const p1 = { x: width * (0.2 + 0.06 * Math.sin(t * 1.1)), y: height * 0.8 + Math.sin(t * 0.9) * 160 };
    const p2 = { x: width * (0.5 + 0.1 * Math.cos(t * 1.8)), y: height * 0.7 + Math.cos(t * 1.3) * 220 };
    const p3 = { x: width * (0.8 + 0.06 * Math.sin(t * 1.4)), y: height * 0.8 + Math.sin(t * 0.6) * 160 };
    return `M0,0 L0,${height} Q${p1.x},${p1.y} ${p2.x},${p2.y} Q${p3.x},${p3.y} ${width},${height} L${width},0 Z`;
  }, [clock]);
  const path4 = useDerivedValue(() => {
    const t = clock.value / 1300 + 3.5;
    const p1 = { x: width * (0.25 + 0.08 * Math.cos(t * 1.3)), y: height * 0.9 + Math.sin(t * 1.1) * 120 };
    const p2 = { x: width * (0.5 + 0.07 * Math.sin(t * 1.6)), y: height * 0.8 + Math.cos(t * 1.5) * 180 };
    const p3 = { x: width * (0.75 + 0.08 * Math.cos(t * 1.2)), y: height * 0.9 + Math.sin(t * 0.5) * 120 };
    return `M0,0 L0,${height} Q${p1.x},${p1.y} ${p2.x},${p2.y} Q${p3.x},${p3.y} ${width},${height} L${width},0 Z`;
  }, [clock]);

  // Statically unroll bubble hooks for each bubble
  const bubble0 = useDerivedValue(() => {
    const t = clock.value / 1000;
    const b = BUBBLES[0];
    const y = (height + b.r * 2) * ((Math.sin(t * b.speed + b.phase) + 1) / 2);
    const x = width * b.xFactor + Math.sin(t * (b.speed * 0.7) + b.phase) * (60 + 40 * Math.sin(t * 0.3 + 0));
    const scale = 0.9 + 0.2 * Math.sin(t * 1.1 + 0);
    const rotation = Math.sin(t * 0.8 + 0) * Math.PI;
    const dynamicOpacity = b.opacity * (0.8 + 0.2 * Math.sin(t * 1.2 + 0));
    const dynamicBlur = b.blur * (0.8 + 0.3 * Math.abs(Math.cos(t * 0.7 + 0)));
    const shineAngle = (t * 0.8 + 0) % (2 * Math.PI);
    return { x, y, scale, rotation, dynamicOpacity, dynamicBlur, shineAngle };
  }, [clock]);
  const bubble1 = useDerivedValue(() => {
    const t = clock.value / 1000;
    const b = BUBBLES[1];
    const y = (height + b.r * 2) * ((Math.sin(t * b.speed + b.phase) + 1) / 2);
    const x = width * b.xFactor + Math.sin(t * (b.speed * 0.7) + b.phase) * (60 + 40 * Math.sin(t * 0.3 + 1));
    const scale = 0.9 + 0.2 * Math.sin(t * 1.1 + 1);
    const rotation = Math.sin(t * 0.8 + 1) * Math.PI;
    const dynamicOpacity = b.opacity * (0.8 + 0.2 * Math.sin(t * 1.2 + 1));
    const dynamicBlur = b.blur * (0.8 + 0.3 * Math.abs(Math.cos(t * 0.7 + 1)));
    const shineAngle = (t * 0.8 + 1) % (2 * Math.PI);
    return { x, y, scale, rotation, dynamicOpacity, dynamicBlur, shineAngle };
  }, [clock]);
  const bubble2 = useDerivedValue(() => {
    const t = clock.value / 1000;
    const b = BUBBLES[2];
    const y = (height + b.r * 2) * ((Math.sin(t * b.speed + b.phase) + 1) / 2);
    const x = width * b.xFactor + Math.sin(t * (b.speed * 0.7) + b.phase) * (60 + 40 * Math.sin(t * 0.3 + 2));
    const scale = 0.9 + 0.2 * Math.sin(t * 1.1 + 2);
    const rotation = Math.sin(t * 0.8 + 2) * Math.PI;
    const dynamicOpacity = b.opacity * (0.8 + 0.2 * Math.sin(t * 1.2 + 2));
    const dynamicBlur = b.blur * (0.8 + 0.3 * Math.abs(Math.cos(t * 0.7 + 2)));
    const shineAngle = (t * 0.8 + 2) % (2 * Math.PI);
    return { x, y, scale, rotation, dynamicOpacity, dynamicBlur, shineAngle };
  }, [clock]);
  const bubble3 = useDerivedValue(() => {
    const t = clock.value / 1000;
    const b = BUBBLES[3];
    const y = (height + b.r * 2) * ((Math.sin(t * b.speed + b.phase) + 1) / 2);
    const x = width * b.xFactor + Math.sin(t * (b.speed * 0.7) + b.phase) * (60 + 40 * Math.sin(t * 0.3 + 3));
    const scale = 0.9 + 0.2 * Math.sin(t * 1.1 + 3);
    const rotation = Math.sin(t * 0.8 + 3) * Math.PI;
    const dynamicOpacity = b.opacity * (0.8 + 0.2 * Math.sin(t * 1.2 + 3));
    const dynamicBlur = b.blur * (0.8 + 0.3 * Math.abs(Math.cos(t * 0.7 + 3)));
    const shineAngle = (t * 0.8 + 3) % (2 * Math.PI);
    return { x, y, scale, rotation, dynamicOpacity, dynamicBlur, shineAngle };
  }, [clock]);
  const bubble4 = useDerivedValue(() => {
    const t = clock.value / 1000;
    const b = BUBBLES[4];
    const y = (height + b.r * 2) * ((Math.sin(t * b.speed + b.phase) + 1) / 2);
    const x = width * b.xFactor + Math.sin(t * (b.speed * 0.7) + b.phase) * (60 + 40 * Math.sin(t * 0.3 + 4));
    const scale = 0.9 + 0.2 * Math.sin(t * 1.1 + 4);
    const rotation = Math.sin(t * 0.8 + 4) * Math.PI;
    const dynamicOpacity = b.opacity * (0.8 + 0.2 * Math.sin(t * 1.2 + 4));
    const dynamicBlur = b.blur * (0.8 + 0.3 * Math.abs(Math.cos(t * 0.7 + 4)));
    const shineAngle = (t * 0.8 + 4) % (2 * Math.PI);
    return { x, y, scale, rotation, dynamicOpacity, dynamicBlur, shineAngle };
  }, [clock]);
  const bubble5 = useDerivedValue(() => {
    const t = clock.value / 1000;
    const b = BUBBLES[5];
    const y = (height + b.r * 2) * ((Math.sin(t * b.speed + b.phase) + 1) / 2);
    const x = width * b.xFactor + Math.sin(t * (b.speed * 0.7) + b.phase) * (60 + 40 * Math.sin(t * 0.3 + 5));
    const scale = 0.9 + 0.2 * Math.sin(t * 1.1 + 5);
    const rotation = Math.sin(t * 0.8 + 5) * Math.PI;
    const dynamicOpacity = b.opacity * (0.8 + 0.2 * Math.sin(t * 1.2 + 5));
    const dynamicBlur = b.blur * (0.8 + 0.3 * Math.abs(Math.cos(t * 0.7 + 5)));
    const shineAngle = (t * 0.8 + 5) % (2 * Math.PI);
    return { x, y, scale, rotation, dynamicOpacity, dynamicBlur, shineAngle };
  }, [clock]);
  const bubble6 = useDerivedValue(() => {
    const t = clock.value / 1000;
    const b = BUBBLES[6];
    const y = (height + b.r * 2) * ((Math.sin(t * b.speed + b.phase) + 1) / 2);
    const x = width * b.xFactor + Math.sin(t * (b.speed * 0.7) + b.phase) * (60 + 40 * Math.sin(t * 0.3 + 6));
    const scale = 0.9 + 0.2 * Math.sin(t * 1.1 + 6);
    const rotation = Math.sin(t * 0.8 + 6) * Math.PI;
    const dynamicOpacity = b.opacity * (0.8 + 0.2 * Math.sin(t * 1.2 + 6));
    const dynamicBlur = b.blur * (0.8 + 0.3 * Math.abs(Math.cos(t * 0.7 + 6)));
    const shineAngle = (t * 0.8 + 6) % (2 * Math.PI);
    return { x, y, scale, rotation, dynamicOpacity, dynamicBlur, shineAngle };
  }, [clock]);
  const bubble7 = useDerivedValue(() => {
    const t = clock.value / 1000;
    const b = BUBBLES[7];
    const y = (height + b.r * 2) * ((Math.sin(t * b.speed + b.phase) + 1) / 2);
    const x = width * b.xFactor + Math.sin(t * (b.speed * 0.7) + b.phase) * (60 + 40 * Math.sin(t * 0.3 + 7));
    const scale = 0.9 + 0.2 * Math.sin(t * 1.1 + 7);
    const rotation = Math.sin(t * 0.8 + 7) * Math.PI;
    const dynamicOpacity = b.opacity * (0.8 + 0.2 * Math.sin(t * 1.2 + 7));
    const dynamicBlur = b.blur * (0.8 + 0.3 * Math.abs(Math.cos(t * 0.7 + 7)));
    const shineAngle = (t * 0.8 + 7) % (2 * Math.PI);
    return { x, y, scale, rotation, dynamicOpacity, dynamicBlur, shineAngle };
  }, [clock]);
  const bubble8 = useDerivedValue(() => {
    const t = clock.value / 1000;
    const b = BUBBLES[8];
    const y = (height + b.r * 2) * ((Math.sin(t * b.speed + b.phase) + 1) / 2);
    const x = width * b.xFactor + Math.sin(t * (b.speed * 0.7) + b.phase) * (60 + 40 * Math.sin(t * 0.3 + 8));
    const scale = 0.9 + 0.2 * Math.sin(t * 1.1 + 8);
    const rotation = Math.sin(t * 0.8 + 8) * Math.PI;
    const dynamicOpacity = b.opacity * (0.8 + 0.2 * Math.sin(t * 1.2 + 8));
    const dynamicBlur = b.blur * (0.8 + 0.3 * Math.abs(Math.cos(t * 0.7 + 8)));
    const shineAngle = (t * 0.8 + 8) % (2 * Math.PI);
    return { x, y, scale, rotation, dynamicOpacity, dynamicBlur, shineAngle };
  }, [clock]);
  const bubble9 = useDerivedValue(() => {
    const t = clock.value / 1000;
    const b = BUBBLES[9];
    const y = (height + b.r * 2) * ((Math.sin(t * b.speed + b.phase) + 1) / 2);
    const x = width * b.xFactor + Math.sin(t * (b.speed * 0.7) + b.phase) * (60 + 40 * Math.sin(t * 0.3 + 9));
    const scale = 0.9 + 0.2 * Math.sin(t * 1.1 + 9);
    const rotation = Math.sin(t * 0.8 + 9) * Math.PI;
    const dynamicOpacity = b.opacity * (0.8 + 0.2 * Math.sin(t * 1.2 + 9));
    const dynamicBlur = b.blur * (0.8 + 0.3 * Math.abs(Math.cos(t * 0.7 + 9)));
    const shineAngle = (t * 0.8 + 9) % (2 * Math.PI);
    return { x, y, scale, rotation, dynamicOpacity, dynamicBlur, shineAngle };
  }, [clock]);
  const bubbleStates = [bubble0, bubble1, bubble2, bubble3, bubble4, bubble5, bubble6, bubble7, bubble8, bubble9];

  // Add derived values for top bubbles (declare individually, not in a map)
  const topBubble0 = useDerivedValue(() => {
    const t = clock.value / 800;
    const b = TOP_BUBBLES[0];
    const y = height * 0.15 * (b.yFactor + 0.5 * (Math.sin(t * b.speed + b.phase) + 1));
    const x = width * b.xFactor + Math.sin(t * (b.speed * 0.9) + b.phase) * (30 + 10 * Math.sin(t * 0.5 + 0));
    const scale = 0.8 + 0.3 * Math.sin(t * 1.3 + 0);
    const dynamicOpacity = b.opacity * (0.7 + 0.3 * Math.sin(t * 1.5 + 0));
    const dynamicBlur = b.blur * (0.7 + 0.4 * Math.abs(Math.cos(t * 0.8 + 0)));
    return { x, y, scale, dynamicOpacity, dynamicBlur };
  }, [clock]);
  const topBubble1 = useDerivedValue(() => {
    const t = clock.value / 800;
    const b = TOP_BUBBLES[1];
    const y = height * 0.15 * (b.yFactor + 0.5 * (Math.sin(t * b.speed + b.phase) + 1));
    const x = width * b.xFactor + Math.sin(t * (b.speed * 0.9) + b.phase) * (30 + 10 * Math.sin(t * 0.5 + 1));
    const scale = 0.8 + 0.3 * Math.sin(t * 1.3 + 1);
    const dynamicOpacity = b.opacity * (0.7 + 0.3 * Math.sin(t * 1.5 + 1));
    const dynamicBlur = b.blur * (0.7 + 0.4 * Math.abs(Math.cos(t * 0.8 + 1)));
    return { x, y, scale, dynamicOpacity, dynamicBlur };
  }, [clock]);
  const topBubble2 = useDerivedValue(() => {
    const t = clock.value / 800;
    const b = TOP_BUBBLES[2];
    const y = height * 0.15 * (b.yFactor + 0.5 * (Math.sin(t * b.speed + b.phase) + 1));
    const x = width * b.xFactor + Math.sin(t * (b.speed * 0.9) + b.phase) * (30 + 10 * Math.sin(t * 0.5 + 2));
    const scale = 0.8 + 0.3 * Math.sin(t * 1.3 + 2);
    const dynamicOpacity = b.opacity * (0.7 + 0.3 * Math.sin(t * 1.5 + 2));
    const dynamicBlur = b.blur * (0.7 + 0.4 * Math.abs(Math.cos(t * 0.8 + 2)));
    return { x, y, scale, dynamicOpacity, dynamicBlur };
  }, [clock]);
  const topBubbleStates = [topBubble0, topBubble1, topBubble2];

  const comet = useComet(clock);

  return (
    <Canvas style={[StyleSheet.absoluteFill, { width, height, position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }]}>
      {/* Comet effect - render above all layers for debug */}
      <Circle
        cx={comet.value.x}
        cy={comet.value.y}
        r={32 - 16 * comet.value.t}
        color={comet.value.color}
        opacity={0.95 * (1 - comet.value.t)}
      >
        <BlurMask blur={40} style="solid" />
      </Circle>
      {/* Comet trail */}
      <Path
        path={`M${comet.value.x - 120 * comet.value.t},${comet.value.y} Q${comet.value.x - 60 * comet.value.t},${comet.value.y + 12} ${comet.value.x},${comet.value.y}`}
        style="stroke"
        strokeWidth={18 - 14 * comet.value.t}
        color={comet.value.color}
        opacity={0.5 * (1 - comet.value.t)}
      >
        <BlurMask blur={28} style="solid" />
      </Path>
      {/* Fluid layers */}
      <Path path={path} style="fill" opacity={1}>
        <LinearGradient start={vec(0, 0)} end={vec(width, height * 0.2)} colors={["#26A7DE", "#23272A00"]} />
        <BlurMask blur={60} style="solid" />
      </Path>
      <Path path={path2} style="fill" opacity={0.7}>
        <LinearGradient start={vec(width, 0)} end={vec(0, height)} colors={["#23272A", "#26A7DE", "#00F0FF"]} />
        <BlurMask blur={30} style="solid" />
      </Path>
      <Path path={path3} style="fill" opacity={0.5}>
        <LinearGradient start={vec(0, height)} end={vec(width, 0)} colors={["#282828", "#B5FFFC", "#23272A"]} />
        <BlurMask blur={20} style="solid" />
      </Path>
      <Path path={path4} style="fill" opacity={0.35}>
        <LinearGradient start={vec(width, height)} end={vec(0, 0)} colors={["#23272A", "#ACE0F9", "#fff"]} />
        <BlurMask blur={18} style="solid" />
      </Path>
      {/* Top bubbles */}
      {topBubbleStates.map((bubble, i) => (
        <Circle
          key={"top-bubble-" + i}
          cx={bubble.value.x}
          cy={bubble.value.y}
          r={TOP_BUBBLES[i].r * bubble.value.scale}
          color={TOP_BUBBLES[i].baseColor}
          opacity={bubble.value.dynamicOpacity}
        >
          <BlurMask blur={bubble.value.dynamicBlur} style="solid" />
        </Circle>
      ))}
      {/* Nuanced, animated, glowing bubbles */}
      {bubbleStates.map((bubble, i) => (
        <React.Fragment key={"bubble-group-" + i}>
          <Circle
            cx={bubble.value.x}
            cy={bubble.value.y}
            r={BUBBLES[i].r}
            color={BUBBLES[i].baseColor}
            opacity={bubble.value.dynamicOpacity}
          >
            <BlurMask blur={bubble.value.dynamicBlur} style="solid" />
          </Circle>
          {/* Shine/Highlight: only on some bubbles for realism */}
          {i % 2 === 0 && (
            <Circle
              cx={bubble.value.x + BUBBLES[i].r * 0.4 * Math.cos(bubble.value.shineAngle)}
              cy={bubble.value.y - BUBBLES[i].r * 0.4 * Math.sin(bubble.value.shineAngle)}
              r={BUBBLES[i].r * 0.22}
              opacity={bubble.value.dynamicOpacity * 0.45}
            >
              <SweepGradient
                c={vec(
                  bubble.value.x + BUBBLES[i].r * 0.4 * Math.cos(bubble.value.shineAngle),
                  bubble.value.y - BUBBLES[i].r * 0.4 * Math.sin(bubble.value.shineAngle)
                )}
                colors={["#fff", "#fff0", "#fff0", "#fff"]}
              />
              <BlurMask blur={BUBBLES[i].r * 0.18} style="solid" />
            </Circle>
          )}
        </React.Fragment>
      ))}
    </Canvas>
  );
} 