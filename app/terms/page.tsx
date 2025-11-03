"use client";

import { useRouter } from 'next/navigation';
import Image from 'next/image';

export default function TermsOfService() {
  const router = useRouter();

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-blue-950 to-slate-900">
      {/* Header with Logo */}
      <div className="border-b border-gray-700">
        <div className="max-w-4xl mx-auto px-4 py-6">
          <button onClick={() => router.push('/pricing')} className="flex items-center gap-2 hover:opacity-80 transition-opacity">
            <Image 
              src="/images/stattrackr-icon.png" 
              alt="StatTrackr Logo" 
              width={32} 
              height={32}
              className="w-8 h-8"
            />
            <h1 className="text-xl font-bold text-white">StatTrackr</h1>
          </button>
        </div>
      </div>

      <div className="max-w-4xl mx-auto px-4 py-12">
        <h1 className="text-4xl font-bold text-white mb-4">Terms of Service</h1>
        <p className="text-gray-400 mb-8">Last Updated: January 2, 2025</p>

        <div className="space-y-8 text-gray-300">
          {/* 1. Acceptance of Terms */}
          <section>
            <h2 className="text-2xl font-bold text-white mb-4">1. Acceptance of Terms</h2>
            <p className="mb-4">
              By accessing or using StatTrackr ("Service", "Platform", "we", "us", or "our"), you agree to be bound by these Terms of Service ("Terms"). If you do not agree to these Terms, you may not access or use the Service.
            </p>
            <p>
              These Terms constitute a legally binding agreement between you ("User", "you", or "your") and StatTrackr. We reserve the right to modify these Terms at any time, and your continued use of the Service constitutes acceptance of any modifications.
            </p>
          </section>

          {/* 2. Description of Service */}
          <section>
            <h2 className="text-2xl font-bold text-white mb-4">2. Description of Service</h2>
            <p className="mb-4">
              StatTrackr provides sports analytics, statistical data, betting insights, and tracking tools for NBA basketball. The Service is intended for informational and entertainment purposes only.
            </p>
            <p className="mb-4 font-semibold text-yellow-400">
              IMPORTANT: StatTrackr does not facilitate, process, or handle any real-money gambling transactions. We do not accept bets, place bets on your behalf, or operate as a bookmaker or betting exchange.
            </p>
            <p className="mb-4">
              StatTrackr is accessible worldwide; however, certain features, content, or services may not be available in all countries or languages. We reserve the right to limit access to specific regions as necessary for legal or operational reasons.
            </p>
          </section>

          {/* 3. No Gambling Guarantees */}
          <section>
            <h2 className="text-2xl font-bold text-white mb-4">3. No Gambling Guarantees</h2>
            <p className="mb-4">
              <strong>DISCLAIMER:</strong> StatTrackr provides data analysis and insights but DOES NOT guarantee winning outcomes, profits, or success in sports betting. All betting activities carry inherent risk, and you may lose money.
            </p>
            <p className="mb-4">
              We do not provide professional gambling advice. Any insights, statistics, or analysis provided through the Service should not be construed as recommendations to place specific bets or financial advice.
            </p>
            <p>
              You acknowledge that gambling involves risk and that you are solely responsible for any betting decisions you make.
            </p>
          </section>

          {/* 4. Age Restrictions and Legal Compliance */}
          <section>
            <h2 className="text-2xl font-bold text-white mb-4">4. Age Restrictions and Legal Compliance</h2>
            <p className="mb-4">
              You must be at least 18 years old (or the legal age of majority in your jurisdiction) to use this Service. By using StatTrackr, you represent and warrant that you meet these age requirements.
            </p>
            <p className="mb-4">
              <strong>You are responsible for ensuring that your use of the Service and any gambling activities comply with all applicable local, state, federal, and international laws and regulations.</strong>
            </p>
            <p className="mb-4">
              If sports betting is illegal in your jurisdiction, you must not use StatTrackr for betting-related purposes. We are not liable for any illegal use of the Service.
            </p>
            <p className="mb-4 font-semibold">
              StatTrackr makes no representations that the Service is appropriate or available for use in all locations, and access from jurisdictions where such content is illegal is prohibited. Users are solely responsible for compliance with their local laws.
            </p>
          </section>

          {/* 5. User Accounts */}
          <section>
            <h2 className="text-2xl font-bold text-white mb-4">5. User Accounts</h2>
            <p className="mb-4">
              To access certain features, you must create an account. You are responsible for:
            </p>
            <ul className="list-disc list-inside space-y-2 ml-4 mb-4">
              <li>Maintaining the confidentiality of your account credentials</li>
              <li>All activities that occur under your account</li>
              <li>Notifying us immediately of any unauthorized access or security breach</li>
              <li>Providing accurate, current, and complete information during registration</li>
            </ul>
            <p>
              You may not share your account with others or allow others to access your account. We reserve the right to suspend or terminate accounts that violate these Terms.
            </p>
          </section>

          {/* 6. Subscription and Payment Terms */}
          <section>
            <h2 className="text-2xl font-bold text-white mb-4">6. Subscription and Payment Terms</h2>
            <p className="mb-4">
              StatTrackr offers both free and paid subscription plans. By subscribing to a paid plan:
            </p>
            <ul className="list-disc list-inside space-y-2 ml-4 mb-4">
              <li>You agree to pay all fees associated with your chosen subscription plan</li>
              <li>Subscriptions automatically renew unless cancelled before the renewal date</li>
              <li>All payments are processed securely through Stripe</li>
              <li>Prices are subject to change with 30 days' notice</li>
              <li>Refunds are provided at our discretion, generally within 7 days of initial purchase</li>
            </ul>
            <p>
              You may cancel your subscription at any time through your account settings. Cancellation will take effect at the end of your current billing period.
            </p>
          </section>

          {/* 7. Data Accuracy and Limitations */}
          <section>
            <h2 className="text-2xl font-bold text-white mb-4">7. Data Accuracy and Limitations</h2>
            <p className="mb-4">
              While we strive to provide accurate and up-to-date information, we do not guarantee the accuracy, completeness, or timeliness of any data, statistics, odds, or analysis provided through the Service.
            </p>
            <p className="mb-4">
              Data may contain errors, delays, or omissions. You acknowledge that:
            </p>
            <ul className="list-disc list-inside space-y-2 ml-4 mb-4">
              <li>Statistical data is provided "as is" without warranties</li>
              <li>We are not liable for decisions made based on our data</li>
              <li>Third-party data sources may have their own terms and limitations</li>
              <li>Technical issues may cause temporary unavailability of data or features</li>
            </ul>
            <p className="mt-4 text-sm text-gray-400">
              <strong>Note:</strong> StatTrackr is an independent analytics platform and is not affiliated with, endorsed by, or sponsored by the National Basketball Association (NBA) or any other sports league or organization. All trademarks, team names, and player images are the property of their respective owners.
            </p>
          </section>

          {/* 8. Intellectual Property */}
          <section>
            <h2 className="text-2xl font-bold text-white mb-4">8. Intellectual Property</h2>
            <p className="mb-4">
              All content, features, and functionality of the Service, including but not limited to text, graphics, logos, software, and data compilations, are owned by StatTrackr and are protected by copyright, trademark, and other intellectual property laws.
            </p>
            <p className="mb-4">
              You may not:
            </p>
            <ul className="list-disc list-inside space-y-2 ml-4 mb-4">
              <li>Copy, reproduce, or distribute any content from the Service without permission</li>
              <li>Reverse engineer, decompile, or disassemble any software or systems</li>
              <li>Use automated tools (bots, scrapers) to access or collect data from the Service</li>
              <li>Resell, sublicense, or commercialize any aspect of the Service</li>
            </ul>
          </section>

          {/* 9. Prohibited Conduct */}
          <section>
            <h2 className="text-2xl font-bold text-white mb-4">9. Prohibited Conduct</h2>
            <p className="mb-4">You agree not to:</p>
            <ul className="list-disc list-inside space-y-2 ml-4 mb-4">
              <li>Violate any applicable laws or regulations</li>
              <li>Infringe on intellectual property rights</li>
              <li>Transmit malicious code, viruses, or harmful materials</li>
              <li>Attempt to gain unauthorized access to our systems or other users' accounts</li>
              <li>Harass, abuse, or harm other users</li>
              <li>Use the Service for any fraudulent or illegal purpose</li>
              <li>Manipulate or interfere with the proper functioning of the Service</li>
              <li>Create multiple accounts to abuse free trials or promotions</li>
            </ul>
          </section>

          {/* 10. Limitation of Liability */}
          <section>
            <h2 className="text-2xl font-bold text-white mb-4">10. Limitation of Liability</h2>
            <p className="mb-4 font-semibold text-yellow-400">
              TO THE MAXIMUM EXTENT PERMITTED BY LAW, STATTRACKR SHALL NOT BE LIABLE FOR ANY INDIRECT, INCIDENTAL, SPECIAL, CONSEQUENTIAL, OR PUNITIVE DAMAGES, INCLUDING BUT NOT LIMITED TO LOSS OF PROFITS, DATA, USE, OR OTHER INTANGIBLE LOSSES.
            </p>
            <p className="mb-4">
              StatTrackr is not liable for:
            </p>
            <ul className="list-disc list-inside space-y-2 ml-4 mb-4">
              <li>Losses resulting from gambling or betting activities</li>
              <li>Decisions made based on data or insights provided by the Service</li>
              <li>Technical failures, outages, or data loss</li>
              <li>Unauthorized access to your account resulting from your failure to secure credentials</li>
              <li>Third-party actions or content</li>
            </ul>
            <p>
              Our total liability to you for all claims shall not exceed the amount you paid to StatTrackr in the 12 months preceding the claim.
            </p>
          </section>

          {/* 11. Indemnification */}
          <section>
            <h2 className="text-2xl font-bold text-white mb-4">11. Indemnification</h2>
            <p>
              You agree to indemnify, defend, and hold harmless StatTrackr, its officers, directors, employees, and agents from any claims, damages, losses, liabilities, and expenses (including legal fees) arising from:
            </p>
            <ul className="list-disc list-inside space-y-2 ml-4 mt-4">
              <li>Your use or misuse of the Service</li>
              <li>Your violation of these Terms</li>
              <li>Your violation of any rights of another party</li>
              <li>Any betting or gambling activities you engage in</li>
            </ul>
          </section>

          {/* 12. Termination */}
          <section>
            <h2 className="text-2xl font-bold text-white mb-4">12. Termination</h2>
            <p className="mb-4">
              We reserve the right to suspend or terminate your access to the Service at any time, with or without cause or notice, including if we believe you have violated these Terms.
            </p>
            <p>
              Upon termination, your right to use the Service will immediately cease, and we may delete your account and data.
            </p>
          </section>

          {/* 13. Disclaimer of Warranties */}
          <section>
            <h2 className="text-2xl font-bold text-white mb-4">13. Disclaimer of Warranties</h2>
            <p className="mb-4 font-semibold">
              THE SERVICE IS PROVIDED "AS IS" AND "AS AVAILABLE" WITHOUT WARRANTIES OF ANY KIND, EITHER EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO IMPLIED WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, OR NON-INFRINGEMENT.
            </p>
            <p>
              We do not warrant that the Service will be uninterrupted, secure, or error-free, or that any defects will be corrected.
            </p>
          </section>

          {/* 14. Governing Law and Dispute Resolution */}
          <section>
            <h2 className="text-2xl font-bold text-white mb-4">14. Governing Law and Dispute Resolution</h2>
            <p className="mb-4">
              These Terms shall be governed by and construed in accordance with the laws of the jurisdiction in which StatTrackr is headquartered, without regard to conflict of law principles.
            </p>
            <p className="mb-4">
              Any disputes arising out of or relating to these Terms or the Service shall be resolved through binding arbitration or proceedings in a competent court within that jurisdiction. Users outside of that jurisdiction agree to submit to its exclusive jurisdiction for resolving such disputes.
            </p>
          </section>

          {/* 15. Contact Information */}
          <section>
            <h2 className="text-2xl font-bold text-white mb-4">15. Contact Information</h2>
            <p>
              For questions about these Terms, please contact us at:
            </p>
            <p className="mt-4">
              <strong>Email:</strong> <a href="mailto:support@stattrackr.co" className="text-purple-400 hover:text-purple-300 underline">support@stattrackr.co</a>
            </p>
          </section>

          {/* Acknowledgment */}
          <section className="bg-slate-800/50 border border-gray-700 rounded-lg p-6">
            <p className="text-sm">
              <strong>By using StatTrackr, you confirm that you have read, understood, and agree to these Terms of Service.</strong>
            </p>
          </section>
        </div>

        {/* Back Button */}
        <div className="mt-12">
          <button
            onClick={() => router.back()}
            className="px-6 py-3 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors font-medium"
          >
            Go Back
          </button>
        </div>
      </div>
    </div>
  );
}
