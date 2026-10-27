import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { QrCode, Wifi, ExternalLink, Download, Copy, Check, X, Smartphone, ArrowRight, ShieldCheck, Sparkles } from 'lucide-react';
import QRCode from 'qrcode';

export const DeviceSetupModal = ({ isOpen, onClose }) => {
  const [qrDataUrl, setQrDataUrl] = useState('');
  const [copied, setCopied] = useState(false);
  const [isRendered, setIsRendered] = useState(false);
  const [isVisible, setIsVisible] = useState(false);

  const WIFI_SSID = 'VoltSense_Setup';
  const WIFI_PAYLOAD = 'WIFI:S:VoltSense_Setup;T:nopass;;';

  useEffect(() => {
    QRCode.toDataURL(WIFI_PAYLOAD, {
      width: 320,
      margin: 1.5,
      color: {
        dark: '#612F2F', // VoltSense Signature Maroon
        light: '#FFFFFF'
      }
    })
      .then(url => setQrDataUrl(url))
      .catch(err => console.error('Failed to generate QR code:', err));
  }, []);

  useEffect(() => {
    let timer;
    if (isOpen) {
      setIsRendered(true);
      timer = setTimeout(() => setIsVisible(true), 50);
    } else {
      setIsVisible(false);
      timer = setTimeout(() => setIsRendered(false), 300);
    }
    return () => clearTimeout(timer);
  }, [isOpen]);

  if (!isRendered) return null;

  const handleCopySsid = () => {
    navigator.clipboard?.writeText(WIFI_SSID);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleDownloadSticker = () => {
    const link = document.createElement('a');
    link.href = '/assets/voltsense_setup_qr_sticker.svg';
    link.download = 'voltsense_setup_qr_sticker.svg';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return createPortal(
    <div className="fixed inset-0 z-[100] flex items-center justify-center safe-modal overflow-y-auto p-4 sm:p-6">
      {/* Backdrop */}
      <div
        className={`fixed inset-0 bg-black/50 backdrop-blur-sm transition-opacity duration-300 ${
          isVisible ? 'opacity-100' : 'opacity-0'
        }`}
        onClick={onClose}
      />

      {/* Modal Dialog */}
      <div
        className={`bg-white rounded-3xl shadow-2xl max-w-lg w-full my-auto z-10 transition-all duration-300 ease-apple-spring transform relative overflow-hidden border border-gray-100 ${
          isVisible ? 'opacity-100 scale-100 translate-y-0' : 'opacity-0 scale-95 translate-y-4'
        }`}
      >
        {/* Header Ribbon */}
        <div className="bg-gradient-to-r from-maroon-800 to-maroon-900 text-white p-6 relative">
          <button
            onClick={onClose}
            aria-label="Close modal"
            className="absolute top-5 right-5 text-white/70 hover:text-white p-1.5 rounded-full hover:bg-white/10 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>

          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-white/10 backdrop-blur-md flex items-center justify-center border border-white/20 text-yellow-300">
              <QrCode className="w-5 h-5" />
            </div>
            <div>
              <span className="text-[10px] font-black uppercase tracking-widest text-maroon-200">
                Seamless Hardware Setup
              </span>
              <h3 className="text-xl font-black text-white tracking-tight">
                Connect VoltSense to Wi-Fi
              </h3>
            </div>
          </div>
        </div>

        {/* Content Body */}
        <div className="p-6 overflow-y-auto max-h-[calc(85vh-120px)] space-y-6">
          {/* QR Code Presentation Box */}
          <div className="flex flex-col items-center bg-gray-50 border border-gray-100 rounded-3xl p-5 text-center">
            <div className="relative group p-3 bg-white rounded-2xl shadow-md border border-maroon-100 mb-3">
              {qrDataUrl ? (
                <img
                  src={qrDataUrl}
                  alt="VoltSense Wi-Fi Setup QR Code"
                  className="w-52 h-52 sm:w-60 sm:h-60 rounded-xl"
                />
              ) : (
                <div className="w-52 h-52 sm:w-60 sm:h-60 flex items-center justify-center bg-gray-100 rounded-xl">
                  <span className="text-xs text-gray-400 font-medium">Generating QR…</span>
                </div>
              )}
              <div className="absolute inset-0 bg-maroon-900/5 rounded-2xl pointer-events-none border border-maroon-500/20" />
            </div>

            <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs font-bold mb-2">
              <Sparkles className="w-3.5 h-3.5 text-emerald-600" />
              <span>Native Camera Auto-Join (iOS & Android)</span>
            </div>

            <p className="text-xs text-gray-600 max-w-sm leading-relaxed">
              Point your smartphone camera at this code. A prompt will appear saying{' '}
              <strong className="text-gray-900">"Join ‘VoltSense_Setup’ Network"</strong>. Tap it to connect instantly!
            </p>
          </div>

          {/* 3-Step Walkthrough */}
          <div className="space-y-3">
            <h4 className="text-xs font-black uppercase tracking-wider text-gray-400">
              How Setup Works (3 Simple Steps)
            </h4>

            {/* Step 1 */}
            <div className="flex items-start gap-3 p-3.5 rounded-2xl bg-white border border-gray-100 shadow-sm">
              <div className="w-7 h-7 rounded-full bg-maroon-100 text-maroon-800 font-black text-xs flex items-center justify-center shrink-0 mt-0.5">
                1
              </div>
              <div className="min-w-0">
                <p className="text-sm font-bold text-gray-900">Power ON your VoltSense unit</p>
                <p className="text-xs text-gray-500 mt-0.5">
                  Flip the rocker switch ON. The <strong className="text-blue-600">Blue LED</strong> will blink fast (150ms) while it broadcasts the setup hotspot.
                </p>
              </div>
            </div>

            {/* Step 2 */}
            <div className="flex items-start gap-3 p-3.5 rounded-2xl bg-white border border-gray-100 shadow-sm">
              <div className="w-7 h-7 rounded-full bg-maroon-100 text-maroon-800 font-black text-xs flex items-center justify-center shrink-0 mt-0.5">
                2
              </div>
              <div className="min-w-0">
                <p className="text-sm font-bold text-gray-900">Scan QR Code or Join Hotspot</p>
                <p className="text-xs text-gray-500 mt-0.5">
                  Scan the QR code with your camera, or connect manually to the open Wi-Fi network:
                </p>
                <div className="flex items-center gap-2 mt-2">
                  <span className="font-mono text-xs font-bold bg-gray-100 px-2.5 py-1 rounded-lg text-gray-800 border border-gray-200">
                    {WIFI_SSID}
                  </span>
                  <button
                    onClick={handleCopySsid}
                    className="flex items-center gap-1 text-[11px] font-bold text-maroon-800 hover:text-maroon-900 px-2 py-1 rounded-md hover:bg-maroon-50 transition-colors"
                  >
                    {copied ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
                    <span>{copied ? 'Copied' : 'Copy'}</span>
                  </button>
                </div>
              </div>
            </div>

            {/* Step 3 */}
            <div className="flex items-start gap-3 p-3.5 rounded-2xl bg-white border border-gray-100 shadow-sm">
              <div className="w-7 h-7 rounded-full bg-maroon-100 text-maroon-800 font-black text-xs flex items-center justify-center shrink-0 mt-0.5">
                3
              </div>
              <div className="min-w-0">
                <p className="text-sm font-bold text-gray-900">Select Wi-Fi & Enter Pairing Code</p>
                <p className="text-xs text-gray-500 mt-0.5">
                  The captive portal pops up automatically. Pick your dormitory 2.4 GHz Wi-Fi and enter the password. The Blue LED turns solid ON, and the device will display an 8-character code to link your account.
                </p>
              </div>
            </div>
          </div>

          {/* Action Links */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 pt-2 border-t border-gray-100">
            <button
              onClick={handleDownloadSticker}
              className="flex items-center justify-center gap-2 p-3 rounded-xl bg-gray-100 hover:bg-gray-200 text-gray-700 font-bold text-xs transition-colors"
            >
              <Download className="w-4 h-4 text-gray-600" />
              <span>Download Printable Label Sticker (SVG)</span>
            </button>

            <a
              href="http://192.168.4.1"
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center justify-center gap-2 p-3 rounded-xl bg-maroon-50 hover:bg-maroon-100 text-maroon-800 font-bold text-xs transition-colors border border-maroon-100"
            >
              <ExternalLink className="w-4 h-4 text-maroon-700" />
              <span>Open Setup Portal (192.168.4.1)</span>
            </a>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
};

export default DeviceSetupModal;
