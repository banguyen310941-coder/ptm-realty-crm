import React from "react";
import { ImageResponse } from "next/og";


export async function GET() {
  return new ImageResponse(
    React.createElement(
      "div",
      {
        style:{
          width:"100%",height:"100%",display:"flex",alignItems:"center",justifyContent:"center",
          background:"linear-gradient(135deg,#0f766e,#14b8a6)",color:"#fff",
          fontSize:56,fontWeight:900,letterSpacing:"-3px",fontFamily:"Arial, sans-serif",
          borderRadius:38
        }
      },
      "PTM"
    ),
    { width:192,height:192 }
  );
}
