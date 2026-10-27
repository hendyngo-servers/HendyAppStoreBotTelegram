import React from 'react';
import CertUploadSecure from '../components/CertUploadSecure';
export default function Certificates(){return <><CertUploadSecure/><section className="panel"><h3>Quản lý chứng chỉ</h3><p>Chứng chỉ ký ứng dụng chỉ nên được lưu trong kho bí mật của nhà cung cấp build. Giao diện này hiện quản lý hướng dẫn và metadata; không upload file khóa riêng qua API.</p></section></>}
