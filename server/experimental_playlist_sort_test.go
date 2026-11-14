package server

import (
	"testing"

	"github.com/navidrome/navidrome/model"
)

func TestExperimentalPlaylistArtistSortUsesPinyinAcrossEntireList(t *testing.T) {
	names := []string{"齐豫", "邰正宵", "刘宗立", "黄贯中", "简上仁", "黎明", "黑豹乐队"}
	tracks := make(model.PlaylistTracks, len(names))
	for i, name := range names {
		tracks[i] = model.PlaylistTrack{MediaFileID: name, MediaFile: model.MediaFile{Artist: name}}
	}
	sorted := sortExperimentalTracks(tracks, "artist", "asc")
	expected := []string{"黑豹乐队", "黄贯中", "简上仁", "黎明", "刘宗立", "齐豫", "邰正宵"}
	for i, want := range expected {
		if got := sorted[i].MediaFile.Artist; got != want {
			t.Fatalf("artist at position %d: got %q, want %q", i+1, got, want)
		}
	}
	if err := verifyExperimentalPlaylistOrder(sorted, sorted); err != nil {
		t.Fatal(err)
	}
	if err := verifyExperimentalPlaylistOrder(sorted, tracks); err == nil {
		t.Fatal("expected validation to reject original unsorted sequence")
	}
}
