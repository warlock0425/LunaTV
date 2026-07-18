// 圖片占位符組件 - 骨架屏效果（支援暗色模式）
// 動畫與配色定義於 globals.css 的 .skeleton-shine：
// 原本每張卡片內嵌一個 <style> 標籤，列表頁會重複輸出數十份相同樣式，
// 且 React 19 對 <style> 元素有特殊的 hoisting 語義，集中到全域樣式更穩妥。
const ImagePlaceholder = ({ aspectRatio }: { aspectRatio: string }) => (
  <div className={`w-full ${aspectRatio} rounded-lg skeleton-shine`} />
);

export { ImagePlaceholder };
