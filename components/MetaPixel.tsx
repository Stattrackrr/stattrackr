'use client';

import Script from 'next/script';

const META_PIXEL_IDS = Array.from(
  new Set(
    [
      process.env.NEXT_PUBLIC_META_PIXEL_ID ?? '25990212100620241',
      '1812371203107877',
      '1111307961276449',
    ].filter(
      (id): id is string => Boolean(id && id.trim())
    )
  )
);

export default function MetaPixel() {
  if (!META_PIXEL_IDS.length) return null;

  const initCalls = META_PIXEL_IDS.map((id) => `fbq('init', '${id}');`).join('\n            ');

  return (
    <>
      <Script
        id="meta-pixel"
        strategy="afterInteractive"
        dangerouslySetInnerHTML={{
          __html: `
            !function(f,b,e,v,n,t,s)
            {if(f.fbq)return;n=f.fbq=function(){n.callMethod?
            n.callMethod.apply(n,arguments):n.queue.push(arguments)};
            if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';
            n.queue=[];t=b.createElement(e);t.async=!0;
            t.src=v;s=b.getElementsByTagName(e)[0];
            s.parentNode.insertBefore(t,s)}(window, document,'script',
            'https://connect.facebook.net/en_US/fbevents.js');
            ${initCalls}
            fbq('track', 'PageView');
          `,
        }}
      />
      <noscript>
        {META_PIXEL_IDS.map((id) => (
          <img
            key={id}
            height="1"
            width="1"
            style={{ display: 'none' }}
            alt=""
            src={`https://www.facebook.com/tr?id=${id}&ev=PageView&noscript=1`}
          />
        ))}
      </noscript>
    </>
  );
}
