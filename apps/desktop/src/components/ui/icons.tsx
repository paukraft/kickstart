import { type SVGProps, useId } from "react";

type IconProps = SVGProps<SVGSVGElement>;

const CODEX_ICON_DATA_URL =
  "data:image/png;base64,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";

export function CursorIcon(props: IconProps) {
  return (
    <svg
      {...props}
      fill="currentColor"
      viewBox="0 0 466.73 532.09"
    >
      <path d="M457.43,125.94L244.42,2.96c-6.84-3.95-15.28-3.95-22.12,0L9.3,125.94c-5.75,3.32-9.3,9.46-9.3,16.11v247.99c0,6.65,3.55,12.79,9.3,16.11l213.01,122.98c6.84,3.95,15.28,3.95,22.12,0l213.01-122.98c5.75-3.32,9.3-9.46,9.3-16.11v-247.99c0-6.65-3.55-12.79-9.3-16.11h-.01ZM444.05,151.99l-205.63,356.16c-1.39,2.4-5.06,1.42-5.06-1.36v-233.21c0-4.66-2.49-8.97-6.53-11.31L24.87,145.67c-2.4-1.39-1.42-5.06,1.36-5.06h411.26c5.84,0,9.49,6.33,6.57,11.39h-.01Z" />
    </svg>
  );
}

export function CodexIcon(props: IconProps) {
  return (
    <svg
      {...props}
      fill="none"
      viewBox="0 0 64 64"
    >
      <image
        height="64"
        href={CODEX_ICON_DATA_URL}
        preserveAspectRatio="xMidYMid meet"
        width="64"
      />
    </svg>
  );
}

export function VisualStudioCodeIcon(props: IconProps) {
  const id = useId();
  const maskId = `${id}-vscode-a`;
  const topShadowFilterId = `${id}-vscode-b`;
  const sideShadowFilterId = `${id}-vscode-c`;
  const overlayGradientId = `${id}-vscode-d`;

  return (
    <svg
      {...props}
      fill="none"
      viewBox="0 0 100 100"
    >
      <mask
        id={maskId}
        height="100"
        maskUnits="userSpaceOnUse"
        width="100"
        x="0"
        y="0"
      >
        <path
          clipRule="evenodd"
          d="M70.912 99.317a6.223 6.223 0 0 0 4.96-.19l20.589-9.907A6.25 6.25 0 0 0 100 83.587V16.413a6.25 6.25 0 0 0-3.54-5.632L75.874.874a6.226 6.226 0 0 0-7.104 1.21L29.355 38.04 12.187 25.01a4.162 4.162 0 0 0-5.318.236l-5.506 5.009a4.168 4.168 0 0 0-.004 6.162L16.247 50 1.36 63.583a4.168 4.168 0 0 0 .004 6.162l5.506 5.01a4.162 4.162 0 0 0 5.318.236l17.168-13.032L68.77 97.917a6.217 6.217 0 0 0 2.143 1.4ZM75.015 27.3 45.11 50l29.906 22.701V27.3Z"
          fill="#fff"
          fillRule="evenodd"
        />
      </mask>
      <g mask={`url(#${maskId})`}>
        <path
          d="M96.461 10.796 75.857.876a6.23 6.23 0 0 0-7.107 1.207l-67.451 61.5a4.167 4.167 0 0 0 .004 6.162l5.51 5.009a4.167 4.167 0 0 0 5.32.236l81.228-61.62c2.725-2.067 6.639-.124 6.639 3.297v-.24a6.25 6.25 0 0 0-3.539-5.63Z"
          fill="#0065A9"
        />
        <g filter={`url(#${topShadowFilterId})`}>
          <path
            d="m96.461 89.204-20.604 9.92a6.229 6.229 0 0 1-7.107-1.207l-67.451-61.5a4.167 4.167 0 0 1 .004-6.162l5.51-5.009a4.167 4.167 0 0 1 5.32-.236l81.228 61.62c2.725 2.067 6.639.124 6.639-3.297v.24a6.25 6.25 0 0 1-3.539 5.63Z"
            fill="#007ACC"
          />
        </g>
        <g filter={`url(#${sideShadowFilterId})`}>
          <path
            d="M75.858 99.126a6.232 6.232 0 0 1-7.108-1.21c2.306 2.307 6.25.674 6.25-2.588V4.672c0-3.262-3.944-4.895-6.25-2.589a6.232 6.232 0 0 1 7.108-1.21l20.6 9.908A6.25 6.25 0 0 1 100 16.413v67.174a6.25 6.25 0 0 1-3.541 5.633l-20.601 9.906Z"
            fill="#1F9CF0"
          />
        </g>
        <path
          clipRule="evenodd"
          d="M70.851 99.317a6.224 6.224 0 0 0 4.96-.19L96.4 89.22a6.25 6.25 0 0 0 3.54-5.633V16.413a6.25 6.25 0 0 0-3.54-5.632L75.812.874a6.226 6.226 0 0 0-7.104 1.21L29.294 38.04 12.126 25.01a4.162 4.162 0 0 0-5.317.236l-5.507 5.009a4.168 4.168 0 0 0-.004 6.162L16.186 50 1.298 63.583a4.168 4.168 0 0 0 .004 6.162l5.507 5.009a4.162 4.162 0 0 0 5.317.236L29.294 61.96l39.414 35.958a6.218 6.218 0 0 0 2.143 1.4ZM74.954 27.3 45.048 50l29.906 22.701V27.3Z"
          fill={`url(#${overlayGradientId})`}
          fillRule="evenodd"
          opacity=".25"
          style={{ mixBlendMode: "overlay" }}
        />
      </g>
      <defs>
        <filter
          colorInterpolationFilters="sRGB"
          filterUnits="userSpaceOnUse"
          height="92.246"
          id={topShadowFilterId}
          width="116.727"
          x="-8.394"
          y="15.829"
        >
          <feFlood
            floodOpacity="0"
            result="BackgroundImageFix"
          />
          <feColorMatrix
            in="SourceAlpha"
            values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 127 0"
          />
          <feOffset />
          <feGaussianBlur stdDeviation="4.167" />
          <feColorMatrix values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0.25 0" />
          <feBlend
            in2="BackgroundImageFix"
            mode="overlay"
            result="effect1_dropShadow"
          />
          <feBlend
            in="SourceGraphic"
            in2="effect1_dropShadow"
            result="shape"
          />
        </filter>
        <filter
          colorInterpolationFilters="sRGB"
          filterUnits="userSpaceOnUse"
          height="116.151"
          id={sideShadowFilterId}
          width="47.917"
          x="60.417"
          y="-8.076"
        >
          <feFlood
            floodOpacity="0"
            result="BackgroundImageFix"
          />
          <feColorMatrix
            in="SourceAlpha"
            values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 127 0"
          />
          <feOffset />
          <feGaussianBlur stdDeviation="4.167" />
          <feColorMatrix values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0.25 0" />
          <feBlend
            in2="BackgroundImageFix"
            mode="overlay"
            result="effect1_dropShadow"
          />
          <feBlend
            in="SourceGraphic"
            in2="effect1_dropShadow"
            result="shape"
          />
        </filter>
        <linearGradient
          gradientUnits="userSpaceOnUse"
          id={overlayGradientId}
          x1="49.939"
          x2="49.939"
          y1=".258"
          y2="99.742"
        >
          <stop stopColor="#fff" />
          <stop
            offset="1"
            stopColor="#fff"
            stopOpacity="0"
          />
        </linearGradient>
      </defs>
    </svg>
  );
}

export function ZedIcon(props: IconProps) {
  const id = useId();
  const clipPathId = `${id}-zed-logo-a`;

  return (
    <svg
      {...props}
      fill="none"
      viewBox="0 0 96 96"
    >
      <g clipPath={`url(#${clipPathId})`}>
        <path
          clipRule="evenodd"
          d="M9 6a3 3 0 0 0-3 3v66H0V9a9 9 0 0 1 9-9h80.379c4.009 0 6.016 4.847 3.182 7.682L43.055 57.187H57V51h6v7.688a4.5 4.5 0 0 1-4.5 4.5H37.055L26.743 73.5H73.5V36h6v37.5a6 6 0 0 1-6 6H20.743L10.243 90H87a3 3 0 0 0 3-3V21h6v66a9 9 0 0 1-9 9H6.621c-4.009 0-6.016-4.847-3.182-7.682L52.757 39H39v6h-6v-7.5a4.5 4.5 0 0 1 4.5-4.5h21.257l10.5-10.5H22.5V60h-6V22.5a6 6 0 0 1 6-6h52.757L85.757 6H9Z"
          fill="currentColor"
          fillRule="evenodd"
        />
      </g>
      <defs>
        <clipPath id={clipPathId}>
          <path
            d="M0 0h96v96H0z"
            fill="#fff"
          />
        </clipPath>
      </defs>
    </svg>
  );
}
