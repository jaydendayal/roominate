"use client";

import { useEffect, useState } from "react";
import { Check, Copy, Link2, LoaderCircle, RefreshCw, Send, ShieldCheck, Users, X } from "lucide-react";
import { apiFetch } from "@/lib/api";
import type { Project } from "@/lib/types";

interface InvitePreview {
  project_name: string;
  inviter_name: string;
  permission: "view" | "edit";
  expires_at: string;
  remaining_uses: number;
}

interface AcceptedInvite {
  project: Project;
  participant_id: string;
  permission: "view" | "edit";
  revision: number;
  expires_at: string;
}

interface SharedProject {
  project: Project;
  permission: "view" | "edit";
  revision: number;
}

function inviteUrl(token: string) {
  const url = new URL(window.location.origin);
  url.searchParams.set("invite", token);
  return url.toString();
}

export function InviteDialog({
  project,
  onClose,
  onProjectChange,
}: {
  project: Project;
  onClose: () => void;
  onProjectChange: (project: Project) => void;
}) {
  const [permission, setPermission] = useState<"view" | "edit">("edit");
  const [expiresInHours, setExpiresInHours] = useState(72);
  const [maxUses, setMaxUses] = useState(5);
  const [busy, setBusy] = useState<"create" | "publish" | "refresh" | null>(null);
  const [message, setMessage] = useState("");
  const collaboration = project.collaboration;
  const link = collaboration ? inviteUrl(collaboration.token) : "";

  const copy = async () => {
    if (!link) return;
    await navigator.clipboard.writeText(link);
    setMessage("Invite link copied.");
  };

  const create = async () => {
    setBusy("create");
    setMessage("");
    try {
      const owner = project.people.find((person) => person.id === project.ownerId)?.name ?? "Roominate member";
      const result = await apiFetch<{ token: string; expires_at: string; permission: "view" | "edit"; revision: number }>("/api/v1/invites", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ project, inviter_name: owner, permission, expires_in_hours: expiresInHours, max_uses: maxUses }),
      });
      onProjectChange({
        ...project,
        collaboration: {
          token: result.token,
          participantId: project.ownerId,
          permission: result.permission,
          revision: result.revision,
          expiresAt: result.expires_at,
        },
      });
      setMessage("Remote invite created. Photos and screenshots were not uploaded.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "The invite could not be created.");
    } finally {
      setBusy(null);
    }
  };

  const publish = async () => {
    if (!collaboration) return;
    setBusy("publish");
    setMessage("");
    try {
      const result = await apiFetch<{ revision: number }>(`/api/v1/invites/${encodeURIComponent(collaboration.token)}/project`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ project, expected_revision: collaboration.revision }),
      });
      onProjectChange({ ...project, collaboration: { ...collaboration, revision: result.revision } });
      setMessage(`Changes published as revision ${result.revision}.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Changes could not be published.");
    } finally {
      setBusy(null);
    }
  };

  const refresh = async () => {
    if (!collaboration) return;
    setBusy("refresh");
    setMessage("");
    try {
      const result = await apiFetch<SharedProject>(`/api/v1/invites/${encodeURIComponent(collaboration.token)}/project`);
      onProjectChange({
        ...result.project,
        id: project.id,
        ownerId: collaboration.participantId,
        collaboration: { ...collaboration, permission: result.permission, revision: result.revision },
      });
      setMessage(`Loaded shared revision ${result.revision}.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "The shared room could not be refreshed.");
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="invite-modal" role="dialog" aria-modal="true" aria-labelledby="invite-title">
      <section className="invite-shell">
        <header>
          <div><p className="eyebrow">Remote collaboration</p><h2 id="invite-title">Invite roommates</h2></div>
          <button className="icon-button" onClick={onClose} aria-label="Close invite dialog"><X size={18} /></button>
        </header>
        {!collaboration ? (
          <>
            <div className="invite-hero"><span><Users size={24} /></span><div><strong>Share the plan, not the private media</strong><p>The room, inventory, placements, and cart are shared. Original photos, videos, and product screenshots stay in this browser.</p></div></div>
            <div className="invite-options">
              <label>Permission<select value={permission} onChange={(event) => setPermission(event.target.value as "view" | "edit")}><option value="edit">Can edit and publish</option><option value="view">View only</option></select></label>
              <label>Expires<select value={expiresInHours} onChange={(event) => setExpiresInHours(Number(event.target.value))}><option value={24}>In 24 hours</option><option value={72}>In 3 days</option><option value={168}>In 7 days</option></select></label>
              <label>Collaborators<select value={maxUses} onChange={(event) => setMaxUses(Number(event.target.value))}><option value={1}>1 person</option><option value={5}>Up to 5</option><option value={10}>Up to 10</option></select></label>
            </div>
            <button className="primary-button invite-primary" onClick={create} disabled={busy !== null}>{busy === "create" ? <LoaderCircle className="spin" size={17} /> : <Link2 size={17} />} Create private invite</button>
          </>
        ) : (
          <>
            <div className="invite-link-row"><input readOnly value={link} aria-label="Invite link" /><button className="primary-button" onClick={copy}><Copy size={16} /> Copy</button></div>
            <p className="invite-secret"><ShieldCheck size={16} /> Anyone with this link can {collaboration.permission === "edit" ? "view, edit, and publish" : "view"} the shared snapshot until {new Date(collaboration.expiresAt).toLocaleString()}. Treat it like a password.</p>
            <div className="invite-sync">
              <div><strong>Shared revision {collaboration.revision}</strong><p>Publishing is explicit so edits from another roommate are never silently overwritten. Refresh before publishing if someone else has edited.</p></div>
              <div><button className="secondary-button" onClick={refresh} disabled={busy !== null}><RefreshCw size={15} /> Refresh</button>{collaboration.permission === "edit" && <button className="primary-button" onClick={publish} disabled={busy !== null}><Send size={15} /> Publish changes</button>}</div>
            </div>
          </>
        )}
        {message && <p className="invite-message"><Check size={15} /> {message}</p>}
      </section>
    </div>
  );
}

export function JoinInvite({ token, onCancel, onJoined }: { token: string; onCancel: () => void; onJoined: (accepted: AcceptedInvite) => void }) {
  const [preview, setPreview] = useState<InvitePreview | null>(null);
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(true);

  useEffect(() => {
    let current = true;
    apiFetch<InvitePreview>(`/api/v1/invites/${encodeURIComponent(token)}`)
      .then((result) => { if (current) setPreview(result); })
      .catch((reason) => { if (current) setError(reason instanceof Error ? reason.message : "This invite is unavailable."); })
      .finally(() => { if (current) setBusy(false); });
    return () => { current = false; };
  }, [token]);

  const join = async () => {
    if (!name.trim()) return;
    setBusy(true);
    setError("");
    try {
      const accepted = await apiFetch<AcceptedInvite>(`/api/v1/invites/${encodeURIComponent(token)}/accept`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ display_name: name }),
      });
      onJoined(accepted);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The invite could not be accepted.");
      setBusy(false);
    }
  };

  return <main className="join-page"><section className="join-card"><span className="brand-mark"><Users size={24} /></span><p className="eyebrow">Roominate invitation</p>{busy && !preview && !error ? <><h1>Opening shared room…</h1><LoaderCircle className="spin" /></> : error ? <><h1>Invite unavailable</h1><p>{error}</p><button className="secondary-button" onClick={onCancel}>Go to Roominate</button></> : preview && <><h1>Join {preview.project_name}</h1><p><strong>{preview.inviter_name}</strong> invited you to {preview.permission === "edit" ? "edit this room and publish changes" : "view this room"}. The link expires {new Date(preview.expires_at).toLocaleString()}.</p><label>Your name<input value={name} onChange={(event) => setName(event.target.value)} maxLength={60} autoFocus placeholder="How roommates will see you" onKeyDown={(event) => { if (event.key === "Enter") void join(); }} /></label><button className="primary-button" onClick={join} disabled={busy || !name.trim()}>{busy ? <LoaderCircle className="spin" size={17} /> : <Users size={17} />} Accept invite</button><button className="text-button" onClick={onCancel}>Not now</button><small>{preview.remaining_uses} invite {preview.remaining_uses === 1 ? "place" : "places"} remaining. Room media is never included.</small></>}</section></main>;
}
