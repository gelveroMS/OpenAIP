"use client";

import * as React from "react";
import Image from "next/image";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import type { ProjectUpdateUi } from "@/features/projects/types";
import { CalendarDays, ChevronLeft, ChevronRight, X } from "lucide-react";

type ViewerState = {
  open: boolean;
  updateId: string | null;
  images: string[];
  index: number;
};

const INITIAL_VIEWER_STATE: ViewerState = {
  open: false,
  updateId: null,
  images: [],
  index: 0,
};
const MAX_VISIBLE_MEDIA = 5;

/**
 * UpdatesTimelineView Component
 * 
 * Renders a timeline of project updates.
 * Features:
 * - Numbered sequential display
 * - Progress percentage badge
 * - Progress bar visualization
 * - Photo gallery (up to 5 photos)
 * - Attendance count (when applicable)
 * - Empty state message
 * 
 * @param updates - Array of project updates to display
 */
export default function UpdatesTimelineView({
  updates,
}: {
  updates: ProjectUpdateUi[];
}) {
  const [viewerState, setViewerState] = React.useState<ViewerState>(INITIAL_VIEWER_STATE);

  const openViewer = React.useCallback(
    (updateId: string, images: string[], index: number) => {
      if (images.length === 0) return;

      const boundedIndex = Math.max(0, Math.min(index, images.length - 1));
      setViewerState({
        open: true,
        updateId,
        images: [...images],
        index: boundedIndex,
      });
    },
    []
  );

  const closeViewer = React.useCallback(() => {
    setViewerState(INITIAL_VIEWER_STATE);
  }, []);

  const goToPreviousImage = React.useCallback(() => {
    setViewerState((previous) => {
      if (!previous.open || previous.images.length <= 1) {
        return previous;
      }

      const nextIndex =
        previous.index === 0 ? previous.images.length - 1 : previous.index - 1;
      return { ...previous, index: nextIndex };
    });
  }, []);

  const goToNextImage = React.useCallback(() => {
    setViewerState((previous) => {
      if (!previous.open || previous.images.length <= 1) {
        return previous;
      }

      const nextIndex =
        previous.index === previous.images.length - 1 ? 0 : previous.index + 1;
      return { ...previous, index: nextIndex };
    });
  }, []);

  const goToImage = React.useCallback((nextIndex: number) => {
    setViewerState((previous) => {
      if (!previous.open || previous.images.length === 0) {
        return previous;
      }

      const boundedIndex = Math.max(0, Math.min(nextIndex, previous.images.length - 1));
      return { ...previous, index: boundedIndex };
    });
  }, []);

  React.useEffect(() => {
    if (!viewerState.open) {
      return undefined;
    }

    function handleWindowKeyDown(event: KeyboardEvent) {
      if (event.key === "ArrowLeft") {
        event.preventDefault();
        goToPreviousImage();
        return;
      }

      if (event.key === "ArrowRight") {
        event.preventDefault();
        goToNextImage();
      }
    }

    window.addEventListener("keydown", handleWindowKeyDown);
    return () => {
      window.removeEventListener("keydown", handleWindowKeyDown);
    };
  }, [viewerState.open, goToNextImage, goToPreviousImage]);

  const activeImageSrc = viewerState.images[viewerState.index] ?? null;
  const hasMultipleViewerImages = viewerState.images.length > 1;

  return (
    <div className="space-y-4">
      <h2 className="text-base font-semibold text-slate-900">Updates Timeline</h2>

      <div className="space-y-4">
        {updates.map((u, idx) => {
          if (u.isHidden && u.isRedacted) {
            return (
              <Card key={u.id} className="border-slate-300 bg-slate-50/80 shadow-sm">
                <CardContent className="p-4 sm:p-5">
                  <p className="whitespace-pre-wrap text-sm italic leading-6 text-slate-600">
                    {u.description}
                  </p>
                </CardContent>
              </Card>
            );
          }

          return (
            <Card key={u.id} className="border-slate-200 shadow-sm">
              <CardContent className="p-4 sm:p-5">
                <div className="flex items-start gap-3">
                  <div className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-[#022437] text-sm font-semibold text-white">
                    {idx + 1}
                  </div>

                  <div className="min-w-0 flex-1">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <div title={u.title} className="truncate text-base font-semibold text-slate-900">
                          {u.title}
                        </div>
                        <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-slate-500">
                          <CalendarDays className="h-4 w-4 text-slate-400" />
                          <span>{u.date}</span>
                          {u.attendanceCount !== undefined ? (
                            <>
                              <span aria-hidden="true" className="text-slate-300">
                                &bull;
                              </span>
                              <span>{u.attendanceCount.toLocaleString()} participants</span>
                            </>
                          ) : null}
                        </div>
                      </div>

                      <div className="flex shrink-0 flex-col items-end gap-2">
                        <Badge
                          variant="outline"
                          className="rounded-full border-emerald-200 bg-emerald-50 text-emerald-700"
                        >
                          {u.progressPercent}% Complete
                        </Badge>
                        {u.isHidden ? (
                          <Badge
                            variant="outline"
                            className="rounded-full border-rose-200 bg-rose-50 text-rose-700"
                          >
                            Hidden
                          </Badge>
                        ) : null}
                      </div>
                    </div>

                    <p className="mt-3 line-clamp-4 text-sm leading-6 text-slate-600">{u.description}</p>

                    {u.isHidden && (u.hiddenReason || u.violationCategory) ? (
                      <div className="mt-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-800">
                        {u.hiddenReason ? <div>Reason: {u.hiddenReason}</div> : null}
                        {u.violationCategory ? <div>Violation Category: {u.violationCategory}</div> : null}
                      </div>
                    ) : null}

                    {u.photoUrls?.length ? (
                      <div className="mt-4">
                        {u.photoUrls.length === 1 ? (
                          <div className="flex justify-center">
                            <button
                              type="button"
                              aria-label="Open update image 1 of 1"
                              className="group relative w-[92%] max-w-full cursor-zoom-in overflow-hidden rounded-xl border border-slate-200 bg-slate-50 sm:w-[85%] md:w-[420px]"
                              onClick={() => openViewer(u.id, u.photoUrls ?? [], 0)}
                            >
                              <div className="relative h-[240px] max-h-[420px] sm:h-[300px] md:h-[320px]">
                                <Image
                                  src={u.photoUrls[0] ?? ""}
                                  alt="Update image 1"
                                  fill
                                  className="object-cover transition duration-200 group-hover:scale-[1.02] group-hover:brightness-95"
                                  sizes="(max-width: 640px) 92vw, (max-width: 768px) 85vw, 420px"
                                />
                              </div>
                            </button>
                          </div>
                        ) : (
                          <div className="flex flex-wrap justify-center gap-3">
                            {u.photoUrls.slice(0, MAX_VISIBLE_MEDIA).map((src: string, photoIndex, visiblePhotos) => {
                              const hiddenCount = u.photoUrls
                                ? Math.max(0, u.photoUrls.length - visiblePhotos.length)
                                : 0;
                              const isOverflowThumb =
                                hiddenCount > 0 && photoIndex === visiblePhotos.length - 1;

                              return (
                                <button
                                  key={`${u.id}-${photoIndex}-${src}`}
                                  type="button"
                                  aria-label={`Open update image ${photoIndex + 1} of ${u.photoUrls?.length ?? 0}`}
                                  className="group relative h-28 w-28 cursor-zoom-in overflow-hidden rounded-lg border border-slate-200 bg-slate-50 transition hover:border-slate-300 sm:h-32 sm:w-32"
                                  onClick={() => openViewer(u.id, u.photoUrls ?? [], photoIndex)}
                                >
                                  <Image
                                    src={src}
                                    alt={`Update image ${photoIndex + 1}`}
                                    fill
                                    className="object-cover transition duration-200 group-hover:scale-[1.03] group-hover:brightness-90"
                                    sizes="(max-width: 640px) 112px, 128px"
                                  />
                                  {isOverflowThumb ? (
                                    <span className="absolute inset-0 grid place-items-center bg-black/60 text-base font-semibold text-white">
                                      +{hiddenCount}
                                    </span>
                                  ) : null}
                                </button>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    ) : null}
                  </div>
                </div>
              </CardContent>
            </Card>
          );
        })}

        {!updates.length ? (
          <div className="text-sm text-slate-500">No updates yet.</div>
        ) : null}
      </div>

      <Dialog
        open={viewerState.open}
        onOpenChange={(open) => {
          if (!open) {
            closeViewer();
          }
        }}
      >
        <DialogContent
          showCloseButton={false}
          overlayClassName="bg-black/85"
          className="h-[92vh] w-[96vw] max-w-none border-none bg-transparent p-0 shadow-none"
        >
          <DialogTitle className="sr-only">Update image viewer</DialogTitle>
          <DialogDescription className="sr-only">
            Fullscreen viewer for project update images.
          </DialogDescription>

          <div className="relative flex h-full w-full items-center justify-center p-4 sm:p-8">
            <DialogClose asChild>
              <button
                type="button"
                aria-label="Close image viewer"
                className="absolute top-2 right-2 z-30 inline-flex h-10 w-10 items-center justify-center rounded-full border border-white/30 bg-black/40 text-white transition hover:bg-black/60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
              >
                <X className="h-5 w-5" />
              </button>
            </DialogClose>

            {activeImageSrc ? (
              <div className="relative h-full w-full max-w-6xl">
                <Image
                  src={activeImageSrc}
                  alt={`Update photo ${viewerState.index + 1} of ${viewerState.images.length}`}
                  fill
                  className="object-contain"
                  sizes="96vw"
                  priority
                />
              </div>
            ) : null}

            {activeImageSrc ? (
              <div className="absolute bottom-4 left-1/2 z-20 -translate-x-1/2">
                <div className="rounded-full bg-black/45 px-3 py-1 text-xs font-medium text-white">
                  {viewerState.index + 1} / {viewerState.images.length}
                </div>
                {hasMultipleViewerImages ? (
                  <div className="mt-2 flex justify-center gap-1.5">
                    {viewerState.images.map((_, imageIndex) => (
                      <button
                        key={`viewer-dot-${imageIndex}`}
                        type="button"
                        aria-label={`Go to image ${imageIndex + 1}`}
                        onClick={() => goToImage(imageIndex)}
                        className={`h-2 w-2 rounded-full transition ${
                          imageIndex === viewerState.index
                            ? "bg-white"
                            : "bg-white/45 hover:bg-white/75"
                        }`}
                      />
                    ))}
                  </div>
                ) : null}
              </div>
            ) : null}

            {hasMultipleViewerImages ? (
              <>
                <button
                  type="button"
                  aria-label="Previous image"
                  onClick={goToPreviousImage}
                  className="absolute left-2 z-20 inline-flex h-10 w-10 items-center justify-center rounded-full border border-white/30 bg-black/45 text-white transition hover:bg-black/65 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white sm:left-5 sm:h-11 sm:w-11"
                >
                  <ChevronLeft className="h-5 w-5" />
                </button>

                <button
                  type="button"
                  aria-label="Next image"
                  onClick={goToNextImage}
                  className="absolute right-2 z-20 inline-flex h-10 w-10 items-center justify-center rounded-full border border-white/30 bg-black/45 text-white transition hover:bg-black/65 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white sm:right-5 sm:h-11 sm:w-11"
                >
                  <ChevronRight className="h-5 w-5" />
                </button>
              </>
            ) : null}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
