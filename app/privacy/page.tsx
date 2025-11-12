"use client";

import { useRouter } from 'next/navigation';
import Image from 'next/image';

export default function PrivacyPolicy() {
  const router = useRouter();

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-blue-950 to-slate-900">
      {/* Header with Logo */}
      <div className="border-b border-gray-700">
        <div className="max-w-4xl mx-auto px-4 py-6">
          <button onClick={() => router.push('/home')} className="flex items-center gap-2 hover:opacity-80 transition-opacity">
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
        <h1 className="text-4xl font-bold text-white mb-4">Privacy Policy</h1>
        <p className="text-gray-400 mb-8">Last Updated: January 2, 2025</p>

        <div className="space-y-8 text-gray-300">
          {/* Introduction */}
          <section>
            <p className="mb-4">
              StatTrackr ("we", "us", "our") is committed to protecting your privacy. This Privacy Policy explains how we collect, use, disclose, and safeguard your personal information when you use our Service.
            </p>
            <p className="mb-4">
              For the purposes of data protection laws, StatTrackr is the "data controller" of your personal information.
            </p>
            <p>
              By using StatTrackr, you consent to the data practices described in this Privacy Policy. If you do not agree with this policy, please discontinue use of the Service.
            </p>
          </section>

          {/* 1. Information We Collect */}
          <section>
            <h2 className="text-2xl font-bold text-white mb-4">1. Information We Collect</h2>
            
            <h3 className="text-xl font-semibold text-white mb-3">1.1 Information You Provide</h3>
            <p className="mb-4">We collect information that you voluntarily provide when you:</p>
            <ul className="list-disc list-inside space-y-2 ml-4 mb-4">
              <li><strong>Create an Account:</strong> Email address, username, password</li>
              <li><strong>Subscribe to Paid Plans:</strong> Payment information (processed securely through Stripe; we do not store full credit card details)</li>
              <li><strong>Use the Bet Journal:</strong> Betting records, wagers, outcomes, and notes you manually enter</li>
              <li><strong>Contact Us:</strong> Name, email, and message content</li>
            </ul>

            <h3 className="text-xl font-semibold text-white mb-3">1.2 Automatically Collected Information</h3>
            <p className="mb-4">When you access the Service, we automatically collect:</p>
            <ul className="list-disc list-inside space-y-2 ml-4 mb-4">
              <li><strong>Usage Data:</strong> Pages visited, features used, time spent, click patterns</li>
              <li><strong>Device Information:</strong> IP address, browser type, operating system, device identifiers</li>
              <li><strong>Cookies and Tracking Technologies:</strong> We use cookies, web beacons, and similar technologies to enhance user experience and analyze usage patterns</li>
              <li><strong>Log Data:</strong> Server logs including timestamps, error messages, and access records</li>
            </ul>

            <h3 className="text-xl font-semibold text-white mb-3">1.3 Third-Party Data</h3>
            <p className="mb-4">
              We collect publicly available sports statistics and data from third-party sources (e.g., NBA stats, injury reports). This data is not personal information about you.
            </p>
          </section>

          {/* 2. How We Use Your Information */}
          <section>
            <h2 className="text-2xl font-bold text-white mb-4">2. How We Use Your Information</h2>
            <p className="mb-4">We use your information to:</p>
            <ul className="list-disc list-inside space-y-2 ml-4 mb-4">
              <li><strong>Provide the Service:</strong> Enable account access, deliver features, and personalize your experience</li>
              <li><strong>Process Payments:</strong> Handle subscriptions and billing through our payment processor (Stripe)</li>
              <li><strong>Communicate with You:</strong> Send account notifications, service updates, and respond to inquiries</li>
              <li><strong>Improve the Service:</strong> Analyze usage patterns, fix bugs, and develop new features</li>
              <li><strong>Security and Fraud Prevention:</strong> Detect and prevent unauthorized access, abuse, and security threats</li>
              <li><strong>Legal Compliance:</strong> Comply with applicable laws, regulations, and legal processes</li>
              <li><strong>Marketing (Optional):</strong> Send promotional emails if you opt-in (you can unsubscribe anytime)</li>
            </ul>
          </section>

          {/* 3. How We Share Your Information */}
          <section>
            <h2 className="text-2xl font-bold text-white mb-4">3. How We Share Your Information</h2>
            <p className="mb-4">We do not sell your personal information. We may share your information with:</p>
            
            <ul className="list-disc list-inside space-y-2 ml-4 mb-4">
              <li><strong>Service Providers:</strong> Third-party vendors who assist with hosting, analytics, payment processing (e.g., Stripe), and customer support. These providers are contractually obligated to protect your data.</li>
              <li><strong>Legal Authorities:</strong> If required by law, court order, or government request, or to protect our rights, property, or safety</li>
              <li><strong>Business Transfers:</strong> In connection with a merger, acquisition, or sale of assets, your information may be transferred to the new entity</li>
              <li><strong>With Your Consent:</strong> We may share information with third parties when you explicitly consent</li>
            </ul>
            <p className="mb-4">
              Our service providers are only permitted to process your information for the specific purposes for which it was provided, in accordance with this Privacy Policy.
            </p>
            
            <p className="font-semibold text-yellow-400">
              We do NOT share your betting journal data or personal betting records with any third parties for marketing or advertising purposes.
            </p>
          </section>

          {/* 4. Cookies and Tracking Technologies */}
          <section>
            <h2 className="text-2xl font-bold text-white mb-4">4. Cookies and Tracking Technologies</h2>
            <p className="mb-4">We use cookies and similar technologies for:</p>
            <ul className="list-disc list-inside space-y-2 ml-4 mb-4">
              <li><strong>Essential Cookies:</strong> Required for authentication and security</li>
              <li><strong>Analytics Cookies:</strong> To understand how users interact with the Service</li>
              <li><strong>Preference Cookies:</strong> To remember your settings and preferences</li>
            </ul>
            <p className="mb-4">
              We may use third-party analytics tools (e.g., Google Analytics) to help us understand user interactions and improve the Service. These tools collect aggregated, non-personal information and operate under their own privacy policies.
            </p>
            <p className="mb-4">
              You can control cookies through your browser settings. Note that disabling cookies may affect functionality.
            </p>
          </section>

          {/* 5. Data Security */}
          <section>
            <h2 className="text-2xl font-bold text-white mb-4">5. Data Security</h2>
            <p className="mb-4">
              We implement industry-standard security measures to protect your information, including:
            </p>
            <ul className="list-disc list-inside space-y-2 ml-4 mb-4">
              <li>Encryption of data in transit (SSL/TLS)</li>
              <li>Encryption of sensitive data at rest</li>
              <li>Regular security audits and vulnerability assessments</li>
              <li>Access controls and authentication mechanisms</li>
              <li>Secure payment processing through PCI-compliant providers</li>
            </ul>
            <p>
              However, no method of transmission over the Internet is 100% secure. While we strive to protect your data, we cannot guarantee absolute security.
            </p>
          </section>

          {/* 6. Data Retention */}
          <section>
            <h2 className="text-2xl font-bold text-white mb-4">6. Data Retention</h2>
            <p className="mb-4">
              We retain your personal information for as long as necessary to:
            </p>
            <ul className="list-disc list-inside space-y-2 ml-4 mb-4">
              <li>Provide the Service and maintain your account</li>
              <li>Comply with legal obligations (e.g., tax records, audit requirements)</li>
              <li>Resolve disputes and enforce our agreements</li>
            </ul>
            <p>
              When you delete your account, we will delete or anonymize your personal information within 90 days, except where we must retain data for legal compliance.
            </p>
          </section>

          {/* 7. Your Privacy Rights */}
          <section>
            <h2 className="text-2xl font-bold text-white mb-4">7. Your Privacy Rights</h2>
            <p className="mb-4">
              Depending on your location, you may have the following rights:
            </p>
            
            <h3 className="text-xl font-semibold text-white mb-3">7.1 General Rights</h3>
            <ul className="list-disc list-inside space-y-2 ml-4 mb-4">
              <li><strong>Access:</strong> Request a copy of your personal information</li>
              <li><strong>Correction:</strong> Request corrections to inaccurate or incomplete data</li>
              <li><strong>Deletion:</strong> Request deletion of your personal information (subject to legal exceptions)</li>
              <li><strong>Data Portability:</strong> Receive your data in a structured, machine-readable format</li>
              <li><strong>Opt-Out:</strong> Unsubscribe from marketing communications</li>
            </ul>

            <h3 className="text-xl font-semibold text-white mb-3">7.2 GDPR Rights (EEA/UK Users)</h3>
            <p className="mb-2">If you are located in the European Economic Area or United Kingdom, you have additional rights under GDPR:</p>
            <ul className="list-disc list-inside space-y-2 ml-4 mb-4">
              <li><strong>Right to Object:</strong> Object to processing based on legitimate interests</li>
              <li><strong>Right to Restrict Processing:</strong> Request limitation of processing in certain circumstances</li>
              <li><strong>Right to Withdraw Consent:</strong> Withdraw consent for data processing at any time</li>
              <li><strong>Right to Lodge a Complaint:</strong> File a complaint with your local data protection authority</li>
            </ul>

            <h3 className="text-xl font-semibold text-white mb-3">7.3 CCPA Rights (California Users)</h3>
            <p className="mb-2">If you are a California resident, you have rights under the California Consumer Privacy Act (CCPA):</p>
            <ul className="list-disc list-inside space-y-2 ml-4 mb-4">
              <li><strong>Right to Know:</strong> Request disclosure of personal information collected, used, and shared</li>
              <li><strong>Right to Delete:</strong> Request deletion of personal information</li>
              <li><strong>Right to Opt-Out:</strong> Opt-out of the sale of personal information (we do not sell your data)</li>
              <li><strong>Right to Non-Discrimination:</strong> We will not discriminate against you for exercising your privacy rights</li>
            </ul>

            <p className="mt-4">
              <strong>To exercise your rights, contact us at:</strong> <a href="mailto:Support@Stattrackr.co" className="text-purple-400 hover:text-purple-300 underline">Support@Stattrackr.co</a>
            </p>
          </section>

          {/* 8. Children's Privacy */}
          <section>
            <h2 className="text-2xl font-bold text-white mb-4">8. Children's Privacy</h2>
            <p className="mb-4">
              StatTrackr is not intended for individuals under the age of 18. We do not knowingly collect personal information from children under 18.
            </p>
            <p className="mb-4">
              If we become aware that we have collected information from a child under 18, we will take steps to delete that information promptly. If you believe we have collected information from a child, please contact us immediately.
            </p>
            <p>
              If you are a parent or guardian and believe your child has provided us with personal information, please contact us immediately so we can take appropriate action.
            </p>
          </section>

          {/* 9. International Data Transfers */}
          <section>
            <h2 className="text-2xl font-bold text-white mb-4">9. International Data Transfers</h2>
            <p className="mb-4">
              Your personal information may be transferred to and processed in countries other than your country of residence. These countries may have different data protection laws than your own.
            </p>
            <p>
              Where required by law, we implement appropriate safeguards — such as Standard Contractual Clauses or equivalent mechanisms — to ensure your information remains protected according to this Privacy Policy.
            </p>
          </section>

          {/* 10. Third-Party Links */}
          <section>
            <h2 className="text-2xl font-bold text-white mb-4">10. Third-Party Links</h2>
            <p>
              The Service may contain links to third-party websites or services. We are not responsible for the privacy practices of these third parties. We encourage you to review their privacy policies before providing any personal information.
            </p>
          </section>

          {/* 11. Do Not Track Signals */}
          <section>
            <h2 className="text-2xl font-bold text-white mb-4">11. Do Not Track Signals</h2>
            <p>
              Some browsers transmit "Do Not Track" (DNT) signals. We do not currently respond to DNT signals, as there is no industry-wide standard for how to interpret and respond to them.
            </p>
          </section>

          {/* 12. Changes to This Privacy Policy */}
          <section>
            <h2 className="text-2xl font-bold text-white mb-4">12. Changes to This Privacy Policy</h2>
            <p className="mb-4">
              We may update this Privacy Policy from time to time. We will notify you of significant changes by:
            </p>
            <ul className="list-disc list-inside space-y-2 ml-4 mb-4">
              <li>Posting the updated policy on this page with a new "Last Updated" date</li>
              <li>Sending an email notification to registered users (for material changes)</li>
            </ul>
            <p>
              Your continued use of the Service after changes take effect constitutes acceptance of the updated Privacy Policy.
            </p>
          </section>

          {/* 13. Contact Us */}
          <section>
            <h2 className="text-2xl font-bold text-white mb-4">13. Contact Us</h2>
            <p className="mb-4">
              If you have questions, concerns, or requests regarding this Privacy Policy or our data practices, please contact us:
            </p>
            <p>
              <strong>Email:</strong> <a href="mailto:support@stattrackr.co" className="text-purple-400 hover:text-purple-300 underline">support@stattrackr.co</a>
            </p>
            <p className="mt-4">
              <strong>Data Protection Officer:</strong> For GDPR-related inquiries, you may contact our Data Protection Officer at the same email address.
            </p>
          </section>

          {/* Acknowledgment */}
          <section className="bg-slate-800/50 border border-gray-700 rounded-lg p-6">
            <p className="text-sm">
              <strong>By using StatTrackr, you confirm that you have read, understood, and agree to this Privacy Policy.</strong>
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

        {/* Last Reviewed */}
        <p className="text-center text-gray-500 text-sm mt-8">
          Last reviewed: January 2, 2025
        </p>
      </div>
    </div>
  );
}
