export default function manifest() {
  return {
    id:"/",
    name:"PTM CRM · Phúc Trường Minh",
    short_name:"PTM CRM",
    description:"CRM nội bộ Phúc Trường Minh cho khách hàng, Fanpage, giỏ mộ phần, giao dịch, tài chính và vận hành.",
    start_url:"/",
    scope:"/",
    display:"standalone",
    background_color:"#f4f7fb",
    theme_color:"#0c1729",
    lang:"vi-VN",
    orientation:"any",
    categories:["business","productivity"],
    prefer_related_applications:false,
    icons:[
      { src:"/pwa/icon-192",sizes:"192x192",type:"image/png",purpose:"any" },
      { src:"/pwa/icon-192",sizes:"192x192",type:"image/png",purpose:"maskable" },
      { src:"/pwa/icon-512",sizes:"512x512",type:"image/png",purpose:"any" },
      { src:"/pwa/icon-512",sizes:"512x512",type:"image/png",purpose:"maskable" }
    ]
  };
}
