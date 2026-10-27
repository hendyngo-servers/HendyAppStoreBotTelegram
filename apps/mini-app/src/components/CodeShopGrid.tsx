import React from 'react';
export type ShopProduct = { id: string; title: string; description?: string; category?: string; price_vnd: number; stock: number; kind: string };
export function CodeShopGrid({ products, busyId, onBuy }: { products: ShopProduct[]; busyId?: string; onBuy: (product: ShopProduct) => void }) {
  const money = (n: number) => `${new Intl.NumberFormat('vi-VN').format(n)} ₫`;
  return <div className="product-grid">{products.map((p) => <article className="product-card" key={p.id}><div className="product-body"><small>{p.category || 'Khác'} · {p.kind.toUpperCase()}</small><h3>{p.title}</h3><p>{p.description}</p><div className="product-footer"><strong>{money(p.price_vnd)}</strong><button disabled={!p.stock || busyId === p.id} onClick={() => onBuy(p)}>{busyId === p.id ? 'Đang mua…' : p.stock ? 'Mua ngay' : 'Hết hàng'}</button></div></div></article>)}</div>;
}
export default CodeShopGrid;
