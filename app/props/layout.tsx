import { CombinedPropsPrefetch } from './CombinedPropsPrefetch';

export default function PropsLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <CombinedPropsPrefetch />
      {children}
    </>
  );
}
