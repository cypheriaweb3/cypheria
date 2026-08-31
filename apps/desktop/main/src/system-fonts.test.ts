import { describe, expect, it } from "vitest"

import { parseSystemProfilerFonts } from "./system-fonts.js"

describe("system font listing", () => {
  it("groups macOS System Profiler fonts by family and infers readable styles", () => {
    const fonts = parseSystemProfilerFonts({
      SPFontsDataType: [
        {
          typefaces: [
            {
              _name: "Example-Regular",
              enabled: "yes",
              family: "Example",
              fullname: "Example",
              style: "常规体",
              valid: "yes",
            },
            {
              _name: "Example-Light",
              enabled: "yes",
              family: "Example",
              fullname: "Example Light",
              style: "细体",
              valid: "yes",
            },
            {
              _name: "Other-Bold",
              enabled: "yes",
              family: "Other",
              fullname: "Other Bold",
              style: "粗体",
              valid: "yes",
            },
          ],
        },
      ],
    })

    expect(fonts).toEqual([
      {
        faces: [
          {
            family: "Example",
            fullName: "Example",
            postscriptName: "Example-Regular",
            style: "Regular",
          },
          {
            family: "Example",
            fullName: "Example Light",
            postscriptName: "Example-Light",
            style: "Light",
          },
        ],
        family: "Example",
        styles: ["Regular", "Light"],
      },
      {
        faces: [
          {
            family: "Other",
            fullName: "Other Bold",
            postscriptName: "Other-Bold",
            style: "Bold",
          },
        ],
        family: "Other",
        styles: ["Bold"],
      },
    ])
  })
})
